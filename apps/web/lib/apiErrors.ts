type ApiErrorBody = {
  error?: string;
  details?: {
    fieldErrors?: Record<string, string[]>;
    formErrors?: string[];
  };
};

export function formatApiError(data: ApiErrorBody, fallback = "Request failed"): string {
  const parts: string[] = [];
  if (data.details?.formErrors?.length) {
    parts.push(...data.details.formErrors);
  }
  if (data.details?.fieldErrors) {
    for (const [field, messages] of Object.entries(data.details.fieldErrors)) {
      for (const message of messages) {
        parts.push(`${field}: ${message}`);
      }
    }
  }
  if (parts.length > 0) {
    return parts.join(" ");
  }
  return data.error ?? fallback;
}
