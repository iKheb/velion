import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";
import { updatePasswordWithRecovery } from "@/services/account-settings.service";
import { toAppError } from "@/services/error.service";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const resetMutation = useMutation({
    mutationFn: updatePasswordWithRecovery,
    onSuccess: () => {
      setError(null);
      setSuccess("Contrasena restablecida correctamente. Ya puedes iniciar sesion.");
      setPassword("");
      setConfirmPassword("");
    },
    onError: (err) => setError(toAppError(err)),
  });

  const canSubmit = password.trim().length >= 6 && confirmPassword.trim().length >= 6 && password === confirmPassword;

  return (
    <main className="grid min-h-screen place-content-center p-6">
      <Card className="w-full max-w-md space-y-4 p-6">
        <h1 className="text-2xl font-black tracking-tight">Restablecer contrasena</h1>
        <p className="text-sm text-zinc-300">Ingresa una contrasena nueva y confírmala para recuperar el acceso.</p>

        <div className="space-y-3">
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Nueva contrasena"
            autoComplete="new-password"
          />
          <Input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Confirmar nueva contrasena"
            autoComplete="new-password"
          />
          {!canSubmit && password.length > 0 && confirmPassword.length > 0 && (
            <p className="text-xs text-red-400">Las contrasenas deben coincidir y tener al menos 6 caracteres.</p>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
          {success && <p className="text-xs text-emerald-400">{success}</p>}

          <Button
            type="button"
            className="w-full"
            disabled={!canSubmit || resetMutation.isPending}
            onClick={() => resetMutation.mutate(password.trim())}
          >
            {resetMutation.isPending ? "Actualizando..." : "Guardar nueva contrasena"}
          </Button>

          <Button type="button" className="w-full bg-zinc-700 hover:bg-zinc-600" onClick={() => navigate(ROUTES.login)}>
            Ir a iniciar sesion
          </Button>
        </div>
      </Card>
    </main>
  );
}
