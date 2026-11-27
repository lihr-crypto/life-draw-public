import { getRequestIdentity, type RequestIdentity } from "./auth";
import { errorResponse, requireOrigin } from "./http";

export async function handleApi(
  request: Request,
  options: {
    mutation?: boolean;
    handler: (identity: RequestIdentity | null) => Promise<Response>;
  },
): Promise<Response> {
  let identity: RequestIdentity | null = null;
  try {
    identity = await getRequestIdentity(request);
    if (options.mutation) requireOrigin(request);
    return await options.handler(identity);
  } catch (error) {
    return errorResponse(error, identity);
  }
}
