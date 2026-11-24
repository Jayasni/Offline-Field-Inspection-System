const BASE = (
    import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

let accessToken: string | null = localStorage.getItem("access_token");
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(value: string | null) {
    accessToken = value;
    if (value) {
        localStorage.setItem("access_token", value);
    } else {
        localStorage.removeItem("access_token");
    }
}

async function refreshAccessToken(): Promise<string | null> {
    if (refreshPromise) return refreshPromise;

    const refreshToken = localStorage.getItem("refresh_token");
    if (!refreshToken) return null;

    refreshPromise = (async () => {
        try {
            const response = await fetch(`${BASE}/api/v1/auth/refresh`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refresh_token: refreshToken }),
            });

            if (!response.ok) {
                setAccessToken(null);
                localStorage.removeItem("refresh_token");
                return null;
            }

            const result = await response.json();
            if (!result.access_token) return null;

            setAccessToken(result.access_token);
            if (result.refresh_token) {
                localStorage.setItem("refresh_token", result.refresh_token);
            }
            return result.access_token as string;
        } catch {
            // Keep local drafts and the cached profile. A later online retry
            // can attempt refresh again while the refresh token remains valid.
            return null;
        } finally {
            refreshPromise = null;
        }
    })();

    return refreshPromise;
}

export async function api<T>(
    path: string,
    options: RequestInit = {},
): Promise<T> {
    const makeRequest = (tokenValue: string | null) => {
        const headers = new Headers(options.headers || {});
        if (!(options.body instanceof FormData)) {
            headers.set("Content-Type", "application/json");
        }
        if (tokenValue) {
            headers.set("Authorization", `Bearer ${tokenValue}`);
        } else {
            headers.delete("Authorization");
        }

        return fetch(`${BASE}${path}`, {
            ...options,
            headers,
        });
    };

    let response = await makeRequest(accessToken);

    // If the access token expired, refresh it once and retry the original
    // request. This is important for automatic offline-to-online sync.
    if (
        response.status === 401 &&
        !path.includes("/auth/login") &&
        !path.includes("/auth/refresh")
    ) {
        const refreshedToken = await refreshAccessToken();
        if (refreshedToken) {
            response = await makeRequest(refreshedToken);
        }
    }

    if (!response.ok) {
        let detail: any;
        try {
            detail = await response.json();
        } catch {
            // The server may return an empty or non-JSON error response.
        }

        const error: any = new Error(
            detail?.detail?.code ||
            detail?.detail ||
            `HTTP ${response.status}`,
        );
        error.status = response.status;
        error.detail = detail?.detail;
        throw error;
    }

    if (response.status === 204) {
        return undefined as T;
    }

    return response.json() as Promise<T>;
}

export async function login(email: string, password: string) {
    const result = await api<any>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
    });

    setAccessToken(result.access_token);
    if (result.refresh_token) {
        localStorage.setItem("refresh_token", result.refresh_token);
    }
    return result.user;
}
