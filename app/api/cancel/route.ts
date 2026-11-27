import { handleApi } from "../../server/handler";
import { asRecord, jsonResponse, readJson, requireIdentity } from "../../server/http";
import { mutateCancel, stateResponse } from "../../server/store";
import { parseRoundId } from "../../server/validation";

export async function POST(request: Request): Promise<Response> {
  return handleApi(request, {
    mutation: true,
    handler: async (identity) => {
      const user = requireIdentity(identity);
      const payload = asRecord(await readJson(request));
      const current = await mutateCancel(user.userId, parseRoundId(payload.roundId));
      return jsonResponse(stateResponse(current, user.userId, user.displayName), identity);
    },
  });
}
