import { handleApi } from "../../server/handler";
import {
  asRecord,
  jsonResponse,
  readJson,
  requireIdentity,
} from "../../server/http";
import {
  libraryResponse,
  mutateLibrary,
  userSpace,
} from "../../server/store";
import { requireMemberError } from "../../server/errors";
import { parseLibraryMutation } from "../../server/validation";

export async function GET(request: Request): Promise<Response> {
  return handleApi(request, {
    handler: async (identity) => {
      const user = requireIdentity(identity);
      const current = await userSpace(user.userId);
      if (!current) throw requireMemberError();
      return jsonResponse(libraryResponse(current), identity);
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleApi(request, {
    mutation: true,
    handler: async (identity) => {
      const user = requireIdentity(identity);
      const payload = asRecord(await readJson(request));
      const current = await mutateLibrary(user.userId, parseLibraryMutation(payload));
      return jsonResponse(libraryResponse(current), identity);
    },
  });
}
