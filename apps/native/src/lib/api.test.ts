import { ApiError, api, apiDelete, apiPatch, apiPost, apiPut } from "./api";

// Stub ./auth so the test never loads better-auth / expo-secure-store native
// modules. cookieHeader() only calls authClient.getCookie().
jest.mock("./auth", () => ({
  authClient: { getCookie: () => "goodstrata.session=abc" },
}));

/** Minimal Response double: only the fields the client touches. */
function response(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("api (GET)", () => {
  it("returns parsed JSON and sends the session cookie + Accept header", async () => {
    fetchMock.mockResolvedValueOnce(response({ scheme: { name: "Ocean View" } }));

    const data = await api<{ scheme: { name: string } }>("/api/schemes/s1");

    expect(data).toEqual({ scheme: { name: "Ocean View" } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://my.goodstrata.com.au/api/schemes/s1");
    expect(init?.headers).toMatchObject({
      Cookie: "goodstrata.session=abc",
      Accept: "application/json",
    });
    expect(init?.method).toBeUndefined();
  });

  it("throws an ApiError carrying code/status/details from the error envelope", async () => {
    fetchMock.mockResolvedValueOnce(
      response(
        { error: { code: "FORBIDDEN", message: "Not a member of this scheme", details: { schemeId: "s1" } } },
        { ok: false, status: 403 },
      ),
    );

    const err = await api("/api/schemes/s1").catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(Error); // stays catch-compatible for old screens
    expect(err.message).toBe("Not a member of this scheme");
    expect(err.code).toBe("FORBIDDEN");
    expect(err.status).toBe(403);
    expect(err.details).toEqual({ schemeId: "s1" });
  });

  it("falls back to a status-line message + UNKNOWN code on a non-JSON body", async () => {
    const res = {
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    } as unknown as Response;
    fetchMock.mockResolvedValueOnce(res);

    const err = (await api("/api/schemes/s1").catch((e) => e)) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("502 /api/schemes/s1");
    expect(err.code).toBe("UNKNOWN");
    expect(err.status).toBe(502);
    expect(err.details).toBeUndefined();
  });
});

describe("write verbs", () => {
  it("apiPost sends a JSON body with Content-Type and returns parsed JSON", async () => {
    fetchMock.mockResolvedValueOnce(response({ status: "approved" }));

    const data = await apiPost<{ status: string }>("/api/schemes/s1/decisions/d1/vote", {
      choice: "approve",
    });

    expect(data).toEqual({ status: "approved" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://my.goodstrata.com.au/api/schemes/s1/decisions/d1/vote");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ choice: "approve" }));
    expect(init?.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("apiPatch issues a PATCH and parses the error envelope on failure", async () => {
    fetchMock.mockResolvedValueOnce(
      response(
        { error: { code: "VALIDATION", message: "Amount must be positive", details: [{ path: ["amount"] }] } },
        { ok: false, status: 422 },
      ),
    );

    const err = (await apiPatch("/api/schemes/s1/budgets/b1", { amount: -1 }).catch(
      (e) => e,
    )) as ApiError;

    expect(fetchMock.mock.calls[0][1]?.method).toBe("PATCH");
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("VALIDATION");
    expect(err.status).toBe(422);
    expect(err.details).toEqual([{ path: ["amount"] }]);
  });

  it("apiPut issues a PUT", async () => {
    fetchMock.mockResolvedValueOnce(response({ ok: true }));
    await apiPut("/api/schemes/s1/profile", { name: "x" });
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PUT");
  });

  it("apiDelete issues a DELETE and omits Content-Type when there is no body", async () => {
    fetchMock.mockResolvedValueOnce(response({ ok: true }));

    await apiDelete("/api/schemes/s1/documents/doc1");

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("DELETE");
    expect(init?.body).toBeUndefined();
    expect(init?.headers).not.toHaveProperty("Content-Type");
  });
});
