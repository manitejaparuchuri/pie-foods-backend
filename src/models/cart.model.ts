import { RowDataPacket } from "mysql2";

export interface CartItem extends RowDataPacket {
  cart_item_id?: string;
  user_id: string;
  product_id: string;
  quantity: string;
  added_at?: string;
}
  