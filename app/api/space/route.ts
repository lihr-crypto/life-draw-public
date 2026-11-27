import { readJson, asRecord, jsonResponse, requireIdentity } from "../../server/http";
import { createSpace, stateResponse } from "../../server/store";
import { handleApi } from "../../server/handler";
import { parseSpaceName } from "../../server/validation";

export async function POST(request: Request): Promise<Response> {
  return handleApi(request, {
    mutation: true,
    handler: async (identity) => {
      const user = requireIdentity(identity);
      const payload = asRecord(await readJson(request));
      const current = await createSpace(
        user.userId,
        user.displayName,
        parseSpaceName(payload.name),
      );
      return jsonResponse(
        stateResponse(current, user.userId, user.displayName),
        identity,
      );
    },
  });
}
