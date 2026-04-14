
export interface LoginResponse {
  message: string;
  token: string;
  user: {
    user_id: number;
    name: string;
    email: string;
    role: string;
  };
}
