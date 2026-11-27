import { handleApi } from "../../server/handler";
import { asRecord, jsonResponse, readJson, requireIdentity } from "../../server/http";
import { mutateDraw, stateResponse } from "../../server/store";

export async function POST(request: Request): Promise<Response> {
  return handleApi(request, {
    mutation: true,
    handler: async (identity) => {
      const user = requireIdentity(identity);
      asRecord(await readJson(request));
      const current = await mutateDraw(user.userId);
      return jsonResponse(stateResponse(current, user.userId, user.displayName), identity);
    },
  });
}
