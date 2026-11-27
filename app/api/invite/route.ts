import { createInvite } from "../../server/store";
import { asRecord, jsonResponse, requireIdentity, readJson } from "../../server/http";
import { handleApi } from "../../server/handler";

export async function POST(request: Request): Promise<Response> {
  return handleApi(request, {
    mutation: true,
    handler: async (identity) => {
      const user = requireIdentity(identity);
      asRecord(await readJson(request));
      return jsonResponse(await createInvite(user.userId), identity);
    },
  });
}
