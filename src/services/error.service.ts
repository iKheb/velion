export const toAppError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  if (error && typeof error === "object") {
    const maybeError = error as {
      message?: string;
      error_description?: string;
      details?: string;
      hint?: string;
    };

    if (maybeError.message) return maybeError.message;
    if (maybeError.error_description) return maybeError.error_description;
    if (maybeError.details) return maybeError.details;
    if (maybeError.hint) return maybeError.hint;
  }

  return "Ocurrió un error inesperado";
};
