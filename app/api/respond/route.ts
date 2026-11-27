import { handleApi } from "../../server/handler";
import { asRecord, jsonResponse, readJson, requireIdentity } from "../../server/http";
import { mutateRespond, stateResponse } from "../../server/store";
import {
  parseProposalAction,
  parseProposalId,
  parseRoundId,
} from "../../server/validation";

export async function POST(request: Request): Promise<Response> {
  return handleApi(request, {
    mutation: true,
    handler: async (identity) => {
      const user = requireIdentity(identity);
      const payload = asRecord(await readJson(request));
      const current = await mutateRespond(
        user.userId,
        parseRoundId(payload.roundId),
        parseProposalId(payload.proposalId),
        parseProposalAction(payload.action),
      );
      return jsonResponse(stateResponse(current, user.userId, user.displayName), identity);
    },
  });
}
