import { joinSpace, stateResponse } from "../../server/store";
import { handleApi } from "../../server/handler";
import {
  asRecord,
  jsonResponse,
  readJson,
  requireIdentity,
} from "../../server/http";
import {
  parseInviteToken,
  parseMemberName,
} from "../../server/validation";

export async function POST(request: Request): Promise<Response> {
  return handleApi(request, {
    mutation: true,
    handler: async (identity) => {
      const user = requireIdentity(identity);
      const payload = asRecord(await readJson(request));
      const current = await joinSpace(
        user.userId,
        parseMemberName(payload.name) ?? user.displayName,
        parseInviteToken(payload.token),
      );
      return jsonResponse(stateResponse(current, user.userId, user.displayName), identity);
    },
  });
}
