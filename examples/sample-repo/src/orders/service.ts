import { getUser } from "../auth/service.ts";

export interface Order {
  id: number;
  userId: number;
  total: number;
  status: "placed" | "refunded";
}

const orders: Order[] = [];

export function placeOrder(userId: number, total: number): Order {
  const user = getUser(userId);
  const discount = user.tier === "gold" ? 0.1 : 0;
  const order: Order = { id: orders.length + 1, userId, total: Math.round(total * (1 - discount)), status: "placed" };
  orders.push(order);
  return order;
}

export function refund(orderId: number): Order {
  const order = orders.find((o) => o.id === orderId);
  if (!order) throw new Error("order not found");
  order.status = "refunded";
  return order;
}
