
export interface OrderItem{
  order_item_id?: number;  // auto-incremented
  order_id?: number;       // linked to orders table
  product_id: number;
  quantity: number;
  price: number;
}
