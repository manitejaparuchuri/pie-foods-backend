export interface ShippingAddress {
  shipping_id?: number;
  user_id: number;
  address: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  phone: string;
}
