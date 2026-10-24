import { AuthService } from "../auth/service.ts";
import { placeOrder, refund } from "../orders/service.ts";

const auth = new AuthService();

export const routes = {
  "POST /api/login": (body: { email: string; password: string }) => auth.login(body.email, body.password),
  "POST /api/orders": (body: { userId: number; total: number }) => placeOrder(body.userId, body.total),
  "POST /api/orders/:id/refund": (params: { id: number }) => refund(params.id),
};
