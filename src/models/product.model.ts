export interface Product {
  product_id: number;

  name: string;
  sub_name?: string;

  description?: string;
  specifications?: string;
  counter_details?: string;
  warranty_installation?: string;
  details?: string;

  price: number;
  stock_quantity: number;

  category_id: number;

  image_url?: string;
  image_url1?: string;
  image_url2?: string;
  image_url3?: string;
  image_url4?: string;
  image_url5?: string;
  image_url6?: string;
  image_url7?: string;
  image_url8?: string;
  image_url9?: string;
  image_url10?: string;

  created_at: string; 
}

