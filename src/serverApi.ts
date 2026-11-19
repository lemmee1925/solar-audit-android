export type MobileApiUser = {
  id: string;
  username: string;
  full_name?: string;
  role?: string;
};

export type MobileApiSite = {
  id: string;
  name: string;
  plants?: Array<{ id: string; name: string; location?: string; capacity_mw?: number | string }>;
  reference_version?: string;
};

export type MobileBootstrap = {
  ok: boolean;
  api_version?: string;
  schema_version?: number;
  application_version?: string;
  server_time?: string;
  user: MobileApiUser;
  sites: MobileApiSite[];
  reference_version?: string;
  capabilities?: Record<string, boolean | string>;
};

export type MobileLoginResult = {
  access_token: string;
  token_type: "Bearer" | string;
  expires_in: number;
  user: MobileApiUser;
  site: { id: string; name: string };
};

async function readResponse(response: Response): Promise<any> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => ({}));
  }
  const text = await response.text().catch(() => "");
  if (text.trim().startsWith("<!DOCTYPE html") || text.includes("<html")) {
    throw new Error(`The server returned a web page instead of the native API (HTTP ${response.status}). Check the API address and server configuration.`);
  }
  throw new Error(text.trim() || `Server request failed (HTTP ${response.status}).`);
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("Enter a full API address starting with http:// or https://.");
  }
  if (!trimmed.toLowerCase().endsWith("/api/mobile/v1")) {
    return `${trimmed}/api/mobile/v1`;
  }
  return trimmed;
}

export async function authenticateAndBootstrap(
  baseUrl: string,
  username: string,
  password: string,
): Promise<{ token: string; login: MobileLoginResult; bootstrap: MobileBootstrap }> {
  const base = normalizeBaseUrl(baseUrl);
  const loginResponse = await fetch(`${base}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username: username.trim(), password }),
  });
  const loginBody = await readResponse(loginResponse);
  if (!loginResponse.ok || !loginBody?.ok || !loginBody?.access_token) {
    throw new Error(String(loginBody?.error || `Login failed (HTTP ${loginResponse.status}).`));
  }

  const bootstrapResponse = await fetch(`${base}/bootstrap`, {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${loginBody.access_token}` },
  });
  const bootstrapBody = await readResponse(bootstrapResponse);
  if (!bootstrapResponse.ok || !bootstrapBody?.ok || !Array.isArray(bootstrapBody?.sites)) {
    throw new Error(String(bootstrapBody?.error || `Reference-data check failed (HTTP ${bootstrapResponse.status}).`));
  }

  return { token: String(loginBody.access_token), login: loginBody as MobileLoginResult, bootstrap: bootstrapBody as MobileBootstrap };
}


export type MobileReferenceDataResponse = {
  ok: boolean;
  complete: boolean;
  site_id: string;
  schema_version: number;
  reference_version: string;
  reference_hash?: string;
  generated_at?: string;
  data: {
    site_id: string;
    plants: Array<{ id: string; name: string; location?: string | null; capacity_mw?: number | string | null }>;
    asset_types: Array<{ id: string | number; name: string }>;
    assets: Array<{ id: string | number; plant_id?: string | null; asset_type_id?: string | number | null; name: string }>;
    checklist: { version: string; questions: Array<Record<string, unknown>> };
    scoring: Record<string, unknown>;
  };
};

export async function downloadSiteReferenceData(
  baseUrl: string,
  token: string,
  siteId: string,
): Promise<MobileReferenceDataResponse> {
  const base = normalizeBaseUrl(baseUrl);
  if (!token.trim()) throw new Error("Sign in to the server before downloading reference data.");
  if (!siteId.trim()) throw new Error("The server did not provide a site ID.");

  const response = await fetch(`${base}/sites/${encodeURIComponent(siteId)}/reference-data`, {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  const body = await readResponse(response);
  if (!response.ok || !body?.ok || body?.complete !== true || !body?.data ||
      body?.data?.site_id !== siteId || !Array.isArray(body?.data?.plants) ||
      !Array.isArray(body?.data?.assets) || !Array.isArray(body?.data?.asset_types) ||
      !Array.isArray(body?.data?.checklist?.questions)) {
    throw new Error(String(body?.error || `Reference-data download failed validation (HTTP ${response.status}).`));
  }
  return body as MobileReferenceDataResponse;
}


export async function createServerPlant(
  baseUrl: string,
  token: string,
  plant: { name: string; location?: string; capacity_mw?: number | null },
): Promise<{ id: string; name: string; location?: string | null; capacity_mw?: number | null; site_id: string }> {
  const base = normalizeBaseUrl(baseUrl);
  if (!token.trim()) throw new Error("Sign in to the server before creating a plant.");
  const response = await fetch(`${base}/plants`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(plant),
  });
  const body = await readResponse(response);
  if (!response.ok || !body?.ok || !body?.plant?.id) {
    throw new Error(String(body?.error || `Plant creation failed (HTTP ${response.status}).`));
  }
  return body.plant;
}


export type PlantSpecs = {
  id: string; name: string; location?: string | null; capacity_mw?: number | string | null;
  building_name?: string | null; roof_type?: string | null; city?: string | null; state?: string | null;
  no_of_blocks?: number | null; dc_capacity?: number | null; ac_capacity?: number | null;
  central_inverter_type?: string | null; central_inverter_count?: number | null;
  string_inverter_type?: string | null; string_inverter_count?: number | null; scb_count?: number | null;
  mms_type?: string | null; mms_count?: number | null; transformer_type?: string | null; transformer_count?: number | null;
  clamps_connectors_count?: number | null; lt_panel_type?: string | null; lt_panel_count?: number | null;
  ht_panel_type?: string | null; ht_panel_count?: number | null; acdb_count?: number | null;
  ups_db_battery_count?: number | null; lightning_protection_count?: number | null;
  dc_earthing?: string | null; ac_earthing?: string | null;
};

async function authenticatedJson(baseUrl: string, token: string, path: string, method: string, payload?: unknown): Promise<any> {
  const base = normalizeBaseUrl(baseUrl);
  if (!token.trim()) throw new Error('Sign in to the server before editing plant data.');
  const response = await fetch(`${base}${path}`, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
  const body = await readResponse(response);
  if (!response.ok || body?.ok !== true) throw new Error(String(body?.error || `Server request failed (HTTP ${response.status}).`));
  return body;
}

export async function getServerPlantSpecs(baseUrl: string, token: string, plantId: string): Promise<PlantSpecs> {
  const body = await authenticatedJson(baseUrl, token, `/plants/${encodeURIComponent(plantId)}/specs`, 'GET');
  if (!body.plant?.id) throw new Error('The server returned incomplete plant specifications.');
  return body.plant as PlantSpecs;
}
export async function saveServerPlantSpecs(baseUrl: string, token: string, plantId: string, specs: Partial<PlantSpecs>): Promise<PlantSpecs> {
  const body = await authenticatedJson(baseUrl, token, `/plants/${encodeURIComponent(plantId)}/specs`, 'PUT', specs);
  if (!body.plant?.id) throw new Error('The server did not confirm the saved plant specifications.');
  return body.plant as PlantSpecs;
}
export async function createServerAsset(baseUrl: string, token: string, plantId: string, asset: { name: string; asset_type_id: number }): Promise<{ id: string; plant_id: string; asset_type_id: number; name: string }> {
  const body = await authenticatedJson(baseUrl, token, `/plants/${encodeURIComponent(plantId)}/assets`, 'POST', asset);
  if (!body.asset?.id) throw new Error('The server did not confirm equipment creation.');
  return body.asset;
}
export async function renameServerAsset(baseUrl: string, token: string, plantId: string, assetId: string, name: string): Promise<void> {
  await authenticatedJson(baseUrl, token, `/plants/${encodeURIComponent(plantId)}/assets/${encodeURIComponent(assetId)}`, 'PATCH', { name });
}
export async function deleteServerAsset(baseUrl: string, token: string, plantId: string, assetId: string): Promise<void> {
  await authenticatedJson(baseUrl, token, `/plants/${encodeURIComponent(plantId)}/assets/${encodeURIComponent(assetId)}`, 'DELETE');
}

export type AuditManifestPayload = {
  local_uuid: string;
  plant_id?: string;
  plant_name: string;
  audit_date: string;
  audit_time: string;
  audit_type: string;
  auditor_name: string;
  auditee_name: string;
  building_name: string;
  capacity_mw: string;
  city: string;
  state: string;
  asset_id_ref: string;
  assets: Array<{ asset_ref: string; asset_type_id: number; asset_name: string; location: string; rank: string; observation: string; remarks: string; is_audited: boolean }>;
  responses: Array<{ asset_ref: string; question_id: number; response_status: "pass" | "fail" | "na" | "ofi"; ofi_category?: string; remarks: string; observation: string }>;
};

export async function syncAuditManifest(
  baseUrl: string, token: string, localAuditId: string, payload: AuditManifestPayload,
): Promise<{ ok: boolean; local_uuid: string; audit_id: string; audit_number: string | number; status: string; asset_map: Record<string, string>; already_submitted?: boolean }> {
  const base = normalizeBaseUrl(baseUrl);
  if (!token.trim()) throw new Error("Sign in to the native API before syncing.");
  if (payload.local_uuid !== localAuditId) throw new Error("Local audit ID mismatch; sync was stopped.");
  const response = await fetch(`${base}/audits/${encodeURIComponent(localAuditId)}/manifest`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const body = await readResponse(response);
  if (!response.ok || body?.ok !== true || body?.local_uuid !== localAuditId || !body?.audit_id) {
    throw new Error(String(body?.error || `Audit manifest sync failed (HTTP ${response.status}).`));
  }
  return body;
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs = 45000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Photo upload timed out. Please check your connection and retry.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function uploadWithRetry<T>(fn: () => Promise<{ response: Response; body: any; validate: (body: any) => T }>, maxAttempts = 3): Promise<T> {
  const backoffs = [500, 1500, 3000];
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { response, body, validate } = await fn();
      if (response.ok) return validate(body);
      const retryable = response.status >= 500 || response.status === 429;
      if (!retryable || attempt === maxAttempts) {
        throw new Error(String(body?.error || `Upload failed (HTTP ${response.status}).`));
      }
      lastError = new Error(String(body?.error || `Server busy (HTTP ${response.status}).`));
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) break;
    }
    await new Promise((resolve) => setTimeout(resolve, backoffs[Math.min(attempt - 1, backoffs.length - 1)]));
  }
  throw lastError instanceof Error ? lastError : new Error("Photo upload failed after retries.");
}

export async function syncAuditPhoto(
  baseUrl: string, token: string, auditId: string, photoId: string, fields: {
    question_id: number; asset_ref: string; asset_id?: string; dataUrl: string;
    captured_at?: string; latitude?: number | null; longitude?: number | null; gps_accuracy?: number | null; remark?: string;
  },
): Promise<{ ok: boolean; photo_id?: string; duplicate?: boolean }> {
  const base = normalizeBaseUrl(baseUrl);
  if (!token.trim()) throw new Error("Sign in before uploading audit photos.");
  const blob = await (await fetch(fields.dataUrl)).blob();
  if (!blob.size) throw new Error("A checkpoint photo is empty or unreadable.");
  if (blob.size > 50 * 1024 * 1024) throw new Error("A photo exceeds the server's 50 MB limit.");
  const capturedAt = fields.captured_at || new Date().toISOString();
  const extension = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : blob.type.includes("gif") ? "gif" : "jpg";
  return uploadWithRetry(async () => {
    const form = new FormData();
    form.append("local_uuid", photoId);
    form.append("audit_local_uuid", auditId);
    form.append("question_id", String(fields.question_id));
    form.append("asset_ref", fields.asset_ref);
    if (fields.asset_id) form.append("asset_id", fields.asset_id);
    form.append("captured_at", capturedAt);
    if (typeof fields.latitude === "number" && Number.isFinite(fields.latitude)) form.append("latitude", String(fields.latitude));
    if (typeof fields.longitude === "number" && Number.isFinite(fields.longitude)) form.append("longitude", String(fields.longitude));
    if (typeof fields.gps_accuracy === "number" && Number.isFinite(fields.gps_accuracy)) form.append("gps_accuracy", String(fields.gps_accuracy));
    if (fields.remark?.trim()) form.append("remark", fields.remark.trim());
    form.append("file", blob, `${photoId}.${extension}`);
    const response = await fetchWithTimeout(`${base}/audits/${encodeURIComponent(auditId)}/photos/${encodeURIComponent(photoId)}`, {
      method: "POST", headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, body: form,
    });
    const body = await readResponse(response);
    return {
      response,
      body,
      validate: (parsed) => {
        if (parsed?.ok !== true) throw new Error(String(parsed?.error || `Photo upload failed (HTTP ${response.status}).`));
        return parsed;
      },
    };
  });
}


export async function completeServerAudit(baseUrl: string, token: string, auditId: string): Promise<{ ok: boolean; status?: string; already_complete?: boolean; audit_number?: string }> {
  const base = normalizeBaseUrl(baseUrl);
  const response = await fetch(`${base}/audits/${encodeURIComponent(auditId)}/complete`, {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ audit_local_uuid: auditId }),
  });
  const body = await readResponse(response);
  if (!response.ok || body?.ok !== true) throw new Error(String(body?.error || `Server audit completion failed (HTTP ${response.status}).`));
  return body;
}


export type ServerObservation = {
  id: string;
  audit_id: string;
  audit_number?: string | null;
  audit_status?: string | null;
  plant_id?: string | null;
  plant_name: string;
  equipment_name: string;
  equipment_type_name?: string;
  asset_id?: string | null;
  audit_response_id: string;
  question_id?: number | null;
  checkpoint_text: string;
  response_status?: string | null;
  finding_type?: "NC" | "OFI" | string;
  ofi_category?: string;
  observation: string;
  severity: string;
  responsible_person: string;
  target_date: string;
  remarks: string;
  action_taken: string;
  closure_date: string;
  reviewer_comments: string;
  review_status: string;
  status: string;
  status_label: string;
  overdue: boolean;
  age_days: number;
  created_at?: string | null;
  updated_at?: string | null;
  reviewed_by: string;
  reviewed_at?: string | null;
  closed_at?: string | null;
  closure_photos: Array<{ id: string; kind: string; captured_at?: string | null; uploaded_at?: string | null }>;
  finding_photo_count: number;
  history: Array<{ id: string; event_type: string; from_status?: string | null; to_status?: string | null; comment: string; actor: string; created_at?: string | null }>;
};

export async function fetchServerObservations(
  baseUrl: string, token: string, auditId?: string,
): Promise<ServerObservation[]> {
  const query = auditId ? `?audit_id=${encodeURIComponent(auditId)}` : "";
  const body = await authenticatedJson(baseUrl, token, `/observations${query}`, "GET");
  if (!Array.isArray(body.observations)) throw new Error("The server returned an invalid observation list.");
  return body.observations as ServerObservation[];
}

export async function saveServerObservationDetails(
  baseUrl: string, token: string, observationId: string,
  details: { observation: string; remarks?: string; severity: string; responsible_person: string; target_date: string },
): Promise<ServerObservation> {
  const body = await authenticatedJson(baseUrl, token, `/observations/${encodeURIComponent(observationId)}/details`, "POST", details);
  if (!body.observation?.id) throw new Error("The server did not confirm observation details.");
  return body.observation as ServerObservation;
}

export async function updateServerObservationAction(
  baseUrl: string, token: string, observationId: string,
  action: { do: "start" | "save" | "submit"; action_taken?: string; closure_date?: string },
): Promise<ServerObservation> {
  const body = await authenticatedJson(baseUrl, token, `/observations/${encodeURIComponent(observationId)}/update`, "POST", action);
  if (!body.observation?.id) throw new Error("The server did not confirm the observation workflow update.");
  return body.observation as ServerObservation;
}

export async function uploadServerObservationPhoto(
  baseUrl: string, token: string, observationId: string, photoId: string, dataUrl: string,
  meta?: { captured_at?: string; latitude?: number | null; longitude?: number | null; gps_accuracy?: number | null },
): Promise<{ ok: boolean; photo_id: string; duplicate?: boolean }> {
  const base = normalizeBaseUrl(baseUrl);
  if (!token.trim()) throw new Error("Sign in before uploading closure evidence.");
  const blob = await (await fetch(dataUrl)).blob();
  if (!blob.size) throw new Error("A closure evidence photo is empty or unreadable.");
  if (blob.size > 50 * 1024 * 1024) throw new Error("A closure evidence photo exceeds the server's 50 MB limit.");
  const form = new FormData();
  const extension = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : blob.type.includes("gif") ? "gif" : "jpg";
  form.append("file", blob, `${photoId}.${extension}`);
  form.append(`photo_captured_at_${photoId}`, meta?.captured_at || new Date().toISOString());
  if (typeof meta?.latitude === "number" && Number.isFinite(meta.latitude)) form.append(`photo_latitude_${photoId}`, String(meta.latitude));
  if (typeof meta?.longitude === "number" && Number.isFinite(meta.longitude)) form.append(`photo_longitude_${photoId}`, String(meta.longitude));
  if (typeof meta?.gps_accuracy === "number" && Number.isFinite(meta.gps_accuracy)) form.append(`photo_accuracy_${photoId}`, String(meta.gps_accuracy));
  const response = await fetch(`${base}/observations/${encodeURIComponent(observationId)}/closure-photos/${encodeURIComponent(photoId)}`, {
    method: "POST", headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, body: form,
  });
  const body = await readResponse(response);
  if (!response.ok || body?.ok !== true || !body?.photo_id) throw new Error(String(body?.error || `Closure photo upload failed (HTTP ${response.status}).`));
  return body;
}

export async function reviewServerObservation(
  baseUrl: string, token: string, observationId: string,
  decision: "accept" | "reject" | "reopen", reviewer_comments: string,
): Promise<ServerObservation> {
  const body = await authenticatedJson(baseUrl, token, `/observations/${encodeURIComponent(observationId)}/review`, "POST", { decision, reviewer_comments });
  if (!body.observation?.id) throw new Error("The server did not confirm the observation review.");
  return body.observation as ServerObservation;
}

export async function reassignServerObservation(
  baseUrl: string, token: string, observationId: string,
  changes: { severity: string; responsible_person: string; target_date: string },
): Promise<ServerObservation> {
  const body = await authenticatedJson(baseUrl, token, `/observations/${encodeURIComponent(observationId)}/reassign`, "POST", changes);
  if (!body.observation?.id) throw new Error("The server did not confirm the observation reassignment.");
  return body.observation as ServerObservation;
}

export async function fetchServerAuditStatuses(baseUrl: string, token: string): Promise<Array<{ id: string; status: string; updated_at?: string | null; audit_number?: string | null }>> {
  const base = normalizeBaseUrl(baseUrl);
  const response = await fetch(`${base}/audits/status`, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
  const body = await readResponse(response);
  if (!response.ok || body?.ok !== true || !Array.isArray(body.audits)) throw new Error(String(body?.error || `Server audit status refresh failed (HTTP ${response.status}).`));
  return body.audits;
}
