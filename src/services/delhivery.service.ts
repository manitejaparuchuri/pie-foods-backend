import axios, { AxiosInstance, AxiosError } from "axios";

/* ===================================================================
   Delhivery Logistics Service
   ===================================================================
   Wraps the Delhivery v1 API for:
     • Waybill generation (fetches a fresh AWB number)
     • Shipment creation (manifests an order with Delhivery)
     • Shipment tracking (pulls status + scan history)
   =================================================================== */

const getEnv = (key: string, fallback = ""): string =>
  String(process.env[key] || "").trim() || fallback;

/** Lazily‑initialised Axios client — created on first call. */
let _client: AxiosInstance | null = null;
function delhiveryClient(): AxiosInstance {
  if (_client) return _client;
  const token = getEnv("DELHIVERY_API_TOKEN");
  const baseURL = getEnv("DELHIVERY_BASE_URL", "https://track.delhivery.com");
  if (!token) {
    throw new Error("DELHIVERY_API_TOKEN is not configured");
  }
  _client = axios.create({
    baseURL,
    timeout: 30_000,
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
  return _client;
}

/* ------------------------------------------------------------------ */
/*  Waybill Generation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Fetch a single waybill (AWB) number from Delhivery.
 * Uses the bulk‑waybill endpoint with cl (client name) and count=1.
 */
export async function generateWaybill(): Promise<string> {
  try {
    const client = delhiveryClient();
    const res = await client.get("/waybill/api/bulk/json/", {
      params: { count: 1 },
    });

    // Delhivery may return { success: true, json: ["waybill_number"] }
    // or just a plain string / array in the response body.
    const data = res.data;

    if (typeof data === "string" && data.trim().length > 0) {
      return data.trim();
    }

    if (data?.json && Array.isArray(data.json) && data.json.length > 0) {
      return String(data.json[0]).trim();
    }

    if (Array.isArray(data) && data.length > 0) {
      return String(data[0]).trim();
    }

    // Fallback: try to extract any waybill-like numeric string from the response
    const raw = JSON.stringify(data);
    const match = raw.match(/\d{10,}/);
    if (match) return match[0];

    throw new Error("Unexpected waybill response format");
  } catch (error) {
    const msg = extractErrorMessage(error);
    console.error("DELHIVERY WAYBILL ERROR:", msg);
    throw new Error(`Failed to generate waybill: ${msg}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Shipment Creation                                                  */
/* ------------------------------------------------------------------ */

export interface ShipmentPayload {
  waybill: string;
  orderId: string;
  /** Consignee details */
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  country?: string;
  /** Package details */
  paymentMode: "Prepaid" | "COD";
  totalAmount: number;
  codAmount?: number;
  /** Product info */
  productDescription: string;
  weight: number; // grams
  quantity: number;
}

interface DelhiveryShipmentResponse {
  success: boolean;
  waybill: string;
  remark?: string;
  cashToCollect?: number;
  packages?: unknown[];
  rmk?: string;
}

/**
 * Create a shipment on Delhivery (a.k.a. "manifestation").
 * The endpoint expects form-encoded data with `format=json&data=<json>`.
 */
export async function createShipment(
  payload: ShipmentPayload
): Promise<DelhiveryShipmentResponse> {
  try {
    const client = delhiveryClient();

    const shipmentData = {
      shipments: [
        {
          waybill: payload.waybill,
          order: payload.orderId,
          name: payload.name,
          add: payload.address,
          city: payload.city,
          state: payload.state,
          pin: payload.pincode,
          country: payload.country || "India",
          phone: payload.phone,
          payment_mode: payload.paymentMode,
          total_amount: payload.totalAmount,
          cod_amount: payload.codAmount || 0,
          order_date: new Date().toISOString(),
          products_desc: payload.productDescription,
          weight: payload.weight,
          quantity: payload.quantity,
          // Warehouse / pickup details
          pickup_location: {
            name: getEnv("DELHIVERY_WAREHOUSE_NAME", "PIE Foods Warehouse"),
            add: getEnv("DELHIVERY_WAREHOUSE_ADDRESS", "Hyderabad"),
            city: getEnv("DELHIVERY_WAREHOUSE_CITY", "Hyderabad"),
            state: getEnv("DELHIVERY_WAREHOUSE_STATE", "Telangana"),
            pin_code: getEnv("DELHIVERY_WAREHOUSE_PIN", "500001"),
            country: getEnv("DELHIVERY_WAREHOUSE_COUNTRY", "India"),
            phone: getEnv("DELHIVERY_WAREHOUSE_PHONE", "8500154397"),
          },
        },
      ],
      pickup_location: {
        name: getEnv("DELHIVERY_WAREHOUSE_NAME", "PIE Foods Warehouse"),
      },
    };

    // Delhivery expects the payload as `format=json&data=<encoded_json>`
    const formBody = `format=json&data=${encodeURIComponent(
      JSON.stringify(shipmentData)
    )}`;

    const res = await client.post("/api/cmu/create.json", formBody, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
    });

    const data = res.data;

    // Check for success
    if (data?.success === false || data?.rmk?.toLowerCase().includes("fail")) {
      throw new Error(
        data?.rmk || data?.remark || "Delhivery rejected the shipment"
      );
    }

    // If packages array exists, use the first one
    const pkg = Array.isArray(data?.packages) ? data.packages[0] : null;

    return {
      success: true,
      waybill: String(
        (pkg as Record<string, unknown>)?.waybill || payload.waybill
      ),
      remark: (pkg as Record<string, unknown>)?.remarks as string || data?.rmk || "Shipment created",
      cashToCollect: Number(
        (pkg as Record<string, unknown>)?.cash_to_collect || 0
      ),
      packages: data?.packages || [],
    };
  } catch (error) {
    const msg = extractErrorMessage(error);
    console.error("DELHIVERY CREATE SHIPMENT ERROR:", msg);
    throw new Error(`Failed to create shipment: ${msg}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Tracking                                                           */
/* ------------------------------------------------------------------ */

export interface TrackingScan {
  status: string;
  statusDateTime: string;
  location: string;
  instructions?: string;
}

export interface TrackingResult {
  waybill: string;
  currentStatus: string;
  currentStatusDate: string | null;
  origin: string | null;
  destination: string | null;
  expectedDeliveryDate: string | null;
  scans: TrackingScan[];
  rawStatus?: string;
}

/**
 * Track a shipment by waybill number.
 */
export async function trackShipment(
  waybill: string
): Promise<TrackingResult> {
  try {
    const client = delhiveryClient();

    const res = await client.get("/api/v1/packages/json/", {
      params: { waybill, verbose: 1 },
    });

    const data = res.data;
    const shipmentData = data?.ShipmentData?.[0]?.Shipment || data?.ShipmentData?.[0] || {};
    const status = shipmentData?.Status || {};
    const scans: TrackingScan[] = [];

    // Parse scan activities
    const rawScans = shipmentData?.Scans || [];
    for (const scanGroup of rawScans) {
      const scanDetail = scanGroup?.ScanDetail || scanGroup;
      if (scanDetail) {
        scans.push({
          status: String(scanDetail.Instructions || scanDetail.Scan || ""),
          statusDateTime: String(scanDetail.StatusDateTime || scanDetail.ScanDateTime || ""),
          location: String(scanDetail.ScannedLocation || scanDetail.ScanLocation || ""),
          instructions: String(scanDetail.Instructions || ""),
        });
      }
    }

    return {
      waybill: String(shipmentData?.AWB || waybill),
      currentStatus: String(
        status.Status ||
        shipmentData?.Status?.Status ||
        shipmentData?.status ||
        "Unknown"
      ),
      currentStatusDate: status.StatusDateTime || null,
      origin: shipmentData?.OriginCity || shipmentData?.Origin || null,
      destination: shipmentData?.DestinationCity || shipmentData?.Destination || null,
      expectedDeliveryDate:
        shipmentData?.ExpectedDeliveryDate ||
        shipmentData?.PromisedDeliveryDate ||
        null,
      scans,
      rawStatus: JSON.stringify(status),
    };
  } catch (error) {
    const msg = extractErrorMessage(error);
    console.error("DELHIVERY TRACKING ERROR:", msg);
    throw new Error(`Failed to track shipment: ${msg}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function extractErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const data = error.response?.data;
    if (typeof data === "string") return data;
    if (data?.message) return String(data.message);
    if (data?.rmk) return String(data.rmk);
    return `HTTP ${error.response?.status || "?"}: ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Returns `true` when DELHIVERY_API_TOKEN is configured.
 */
export function isDelhiveryConfigured(): boolean {
  return !!getEnv("DELHIVERY_API_TOKEN");
}
