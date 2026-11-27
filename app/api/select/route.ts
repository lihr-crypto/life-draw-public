import { handleApi } from "../../server/handler";
import { asRecord, jsonResponse, readJson, requireIdentity } from "../../server/http";
import { mutateSelect, stateResponse } from "../../server/store";
import { parseCardId, parseProposalId, parseRoundId } from "../../server/validation";

export async function POST(request: Request): Promise<Response> {
  return handleApi(request, {
    mutation: true,
    handler: async (identity) => {
      const user = requireIdentity(identity);
      const payload = asRecord(await readJson(request));
      const current = await mutateSelect(
        user.userId,
        parseRoundId(payload.roundId),
        parseCardId(payload.cardId),
        parseProposalId(payload.proposalId),
      );
      return jsonResponse(stateResponse(current, user.userId, user.displayName), identity);
    },
  });
}
