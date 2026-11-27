import { handleApi } from "../../server/handler";
import { jsonResponse, requireIdentity } from "../../server/http";
import { exportResponse, userSpace } from "../../server/store";
import { requireMemberError } from "../../server/errors";

export async function GET(request: Request): Promise<Response> {
  return handleApi(request, {
    handler: async (identity) => {
      const user = requireIdentity(identity);
      const current = await userSpace(user.userId);
      if (!current) throw requireMemberError();
      return jsonResponse(exportResponse(current), identity);
    },
  });
}
