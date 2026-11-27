import { appStateForUser } from "../../server/store";
import { requireIdentity } from "../../server/http";
import { jsonResponse } from "../../server/http";
import { handleApi } from "../../server/handler";

export async function GET(request: Request): Promise<Response> {
  return handleApi(request, {
    handler: async (identity) => {
      const user = requireIdentity(identity);
      return jsonResponse(
        await appStateForUser(user.userId, user.displayName),
        identity,
      );
    },
  });
}
