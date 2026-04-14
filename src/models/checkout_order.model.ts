
export interface Order{
  order_id?: number;       // auto-incremented
  user_id: number;
  order_date?: Date;       // auto-filled by SQL
  status?: string;         // default 'Pending'
  total_amount: number;
  shipping_id?: number;
}