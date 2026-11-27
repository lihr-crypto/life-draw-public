export { ServiceError, invalidRequest } from "./core";
import { ServiceError } from "./core";

export function requireMemberError(): ServiceError {
  return new ServiceError(401, "member_required", "加入一个空间后才能执行此操作。");
}
