import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useAuth } from "@/hooks/useAuth";
import { requestPasswordRecovery } from "@/services/auth.service";
import { toAppError } from "@/services/error.service";
import { ROUTES } from "@/lib/constants";

const loginSchema = z.object({
  email: z.string().email("Correo invalido"),
  password: z.string().min(6, "Minimo 6 caracteres"),
});

const registerSchema = z
  .object({
    first_name: z.string().min(2, "Ingresa tu nombre"),
    last_name: z.string().min(2, "Ingresa tu apellido"),
    email: z.string().email("Correo invalido"),
    phone: z.string().optional(),
    password: z.string().min(6, "Minimo 6 caracteres"),
    confirm_password: z.string().min(6, "Minimo 6 caracteres"),
    birth_date: z.string().min(1, "La fecha de nacimiento es obligatoria"),
    country: z.string().min(2, "El pais es obligatorio"),
    city: z.string().min(2, "La ciudad es obligatoria"),
    accept_terms: z.boolean(),
  })
  .refine((value) => value.password === value.confirm_password, {
    message: "Las contrasenas no coinciden",
    path: ["confirm_password"],
  })
  .refine((value) => value.accept_terms === true, {
    message: "Debes aceptar terminos y condiciones",
    path: ["accept_terms"],
  });

type LoginFormValues = z.infer<typeof loginSchema>;
type RegisterFormValues = z.infer<typeof registerSchema>;

const termsContent = `
1. Uso responsable: No publiques contenido ilegal, ofensivo o que vulnere derechos de terceros.
2. Seguridad: Eres responsable de mantener segura tu cuenta y contrasena.
3. Privacidad: Velion aplica configuraciones de privacidad y permisos definidas por cada usuario.
4. Moderacion: Velion puede moderar, limitar o suspender cuentas por incumplimiento.
5. Propiedad de contenido: Conservas tus derechos sobre tu contenido, otorgando a Velion permiso para mostrarlo en la plataforma.
6. Servicio: Las funciones pueden cambiar, mejorarse o limitarse para mantener seguridad y estabilidad.
`;

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [termsModalOpen, setTermsModalOpen] = useState(false);
  const [forgotModalOpen, setForgotModalOpen] = useState(false);
  const [recoveryIdentifier, setRecoveryIdentifier] = useState("");
  const navigate = useNavigate();
  const { login, register, loading, error, profile } = useAuth();

  const loginForm = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const registerForm = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      password: "",
      confirm_password: "",
      birth_date: "",
      country: "",
      city: "",
      accept_terms: false,
    },
  });

  const recoveryMutation = useMutation({
    mutationFn: requestPasswordRecovery,
    onSuccess: () => {
      setSubmitError(null);
      setMessage("Si el identificador coincide con una cuenta, enviamos un enlace de recuperacion al correo registrado.");
      setRecoveryIdentifier("");
      setForgotModalOpen(false);
    },
    onError: (err) => setSubmitError(toAppError(err)),
  });

  useEffect(() => {
    if (profile) {
      void navigate(ROUTES.home);
    }
  }, [navigate, profile]);

  const onSubmitLogin = loginForm.handleSubmit(async (values) => {
    setSubmitError(null);
    setMessage(null);

    try {
      await login(values);
    } catch (err) {
      setSubmitError(toAppError(err));
    }
  });

  const onSubmitRegister = registerForm.handleSubmit(async (values) => {
    setSubmitError(null);
    setMessage(null);

    try {
      await register({
        first_name: values.first_name.trim(),
        last_name: values.last_name.trim(),
        email: values.email.trim().toLowerCase(),
        phone: values.phone?.trim() || undefined,
        password: values.password,
        birth_date: values.birth_date,
        country: values.country.trim(),
        city: values.city.trim(),
      });
      setMessage("Cuenta creada correctamente. Ya puedes usar Velion.");
      setMode("login");
      registerForm.reset();
    } catch (err) {
      setSubmitError(toAppError(err));
    }
  });

  return (
    <main className="grid min-h-screen place-content-center p-6">
      <Card className="w-full max-w-xl space-y-4 p-6">
        <h1 className="text-3xl font-black tracking-tight">Velion</h1>
        <p className="text-sm text-zinc-300">Red social gamer, streaming y comunidad en un solo lugar.</p>

        <div className="grid grid-cols-2 rounded-xl bg-velion-black/50 p-1">
          <button
            className={`rounded-lg px-3 py-2 text-sm ${mode === "login" ? "bg-velion-fuchsia/25 text-white" : "text-zinc-300"}`}
            onClick={() => setMode("login")}
            type="button"
          >
            Iniciar sesion
          </button>
          <button
            className={`rounded-lg px-3 py-2 text-sm ${mode === "register" ? "bg-velion-fuchsia/25 text-white" : "text-zinc-300"}`}
            onClick={() => setMode("register")}
            type="button"
          >
            Registrarse
          </button>
        </div>

        {mode === "login" ? (
          <form className="space-y-3" onSubmit={onSubmitLogin}>
            <Input type="email" placeholder="Correo" autoComplete="email" {...loginForm.register("email")} />
            {loginForm.formState.errors.email && <p className="text-xs text-red-400">{loginForm.formState.errors.email.message}</p>}

            <Input type="password" placeholder="Contrasena" autoComplete="current-password" {...loginForm.register("password")} />
            {loginForm.formState.errors.password && <p className="text-xs text-red-400">{loginForm.formState.errors.password.message}</p>}

            <button type="button" className="text-xs text-zinc-300 hover:text-white" onClick={() => setForgotModalOpen(true)}>
              Olvidaste tu contrasena?
            </button>

            {(submitError ?? error) && <p className="text-xs text-red-400">{submitError ?? error}</p>}
            {message && <p className="text-xs text-emerald-400">{message}</p>}

            <Button type="submit" className="w-full" disabled={loading || loginForm.formState.isSubmitting}>
              Entrar
            </Button>
          </form>
        ) : (
          <form className="grid gap-3 md:grid-cols-2" onSubmit={onSubmitRegister}>
            <Input type="text" placeholder="Nombres" {...registerForm.register("first_name")} />
            <Input type="text" placeholder="Apellidos" {...registerForm.register("last_name")} />
            {registerForm.formState.errors.first_name && <p className="text-xs text-red-400">{registerForm.formState.errors.first_name.message}</p>}
            {registerForm.formState.errors.last_name && <p className="text-xs text-red-400">{registerForm.formState.errors.last_name.message}</p>}

            <Input type="email" placeholder="Correo electronico" {...registerForm.register("email")} className="md:col-span-2" />
            {registerForm.formState.errors.email && <p className="text-xs text-red-400 md:col-span-2">{registerForm.formState.errors.email.message}</p>}

            <Input type="text" placeholder="Numero de telefono (opcional)" {...registerForm.register("phone")} className="md:col-span-2" />

            <Input type="password" placeholder="Contrasena" autoComplete="new-password" {...registerForm.register("password")} />
            <Input type="password" placeholder="Confirmar contrasena" autoComplete="new-password" {...registerForm.register("confirm_password")} />
            {registerForm.formState.errors.password && <p className="text-xs text-red-400">{registerForm.formState.errors.password.message}</p>}
            {registerForm.formState.errors.confirm_password && (
              <p className="text-xs text-red-400">{registerForm.formState.errors.confirm_password.message}</p>
            )}

            <Input type="date" {...registerForm.register("birth_date")} />
            <Input type="text" placeholder="Pais" {...registerForm.register("country")} />
            {registerForm.formState.errors.birth_date && <p className="text-xs text-red-400">{registerForm.formState.errors.birth_date.message}</p>}
            {registerForm.formState.errors.country && <p className="text-xs text-red-400">{registerForm.formState.errors.country.message}</p>}

            <Input type="text" placeholder="Ciudad" {...registerForm.register("city")} className="md:col-span-2" />
            {registerForm.formState.errors.city && <p className="text-xs text-red-400 md:col-span-2">{registerForm.formState.errors.city.message}</p>}

            <label className="md:col-span-2 flex items-start gap-2 text-xs text-zinc-300">
              <input type="checkbox" className="mt-0.5" {...registerForm.register("accept_terms")} />
              <span>
                Acepto los terminos y condiciones de Velion.
                {" "}
                <button type="button" className="underline hover:text-white" onClick={() => setTermsModalOpen(true)}>
                  Ver terminos y condiciones
                </button>
              </span>
            </label>
            {registerForm.formState.errors.accept_terms && (
              <p className="text-xs text-red-400 md:col-span-2">{registerForm.formState.errors.accept_terms.message}</p>
            )}

            {(submitError ?? error) && <p className="text-xs text-red-400 md:col-span-2">{submitError ?? error}</p>}
            {message && <p className="text-xs text-emerald-400 md:col-span-2">{message}</p>}

            <Button type="submit" className="w-full md:col-span-2" disabled={loading || registerForm.formState.isSubmitting}>
              Crear cuenta
            </Button>
          </form>
        )}
      </Card>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-xs text-zinc-400">
        <Link className="hover:text-white hover:underline" to={ROUTES.terms}>
          Terminos
        </Link>
        <Link className="hover:text-white hover:underline" to={ROUTES.privacy}>
          Privacidad
        </Link>
        <a className="hover:text-white hover:underline" href="mailto:soporte@velion.app">
          Soporte
        </a>
      </div>

      <Modal open={termsModalOpen} onClose={() => setTermsModalOpen(false)} title="Terminos y Condiciones de Velion">
        <div className="space-y-3 text-sm text-zinc-200">
          <p className="text-zinc-300 whitespace-pre-line">{termsContent}</p>
          <div className="flex justify-end">
            <Button type="button" onClick={() => setTermsModalOpen(false)}>
              Entendido
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={forgotModalOpen} onClose={() => setForgotModalOpen(false)} title="Recuperar contrasena">
        <div className="space-y-3">
          <p className="text-sm text-zinc-300">
            Ingresa tu usuario, correo electronico o numero de telefono. Si coincide con una cuenta, enviaremos un enlace de recuperacion al correo registrado.
          </p>
          <Input
            type="text"
            value={recoveryIdentifier}
            onChange={(event) => setRecoveryIdentifier(event.target.value)}
            placeholder="Usuario, correo o telefono"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setForgotModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={!recoveryIdentifier.trim() || recoveryMutation.isPending}
              onClick={() => recoveryMutation.mutate(recoveryIdentifier)}
            >
              {recoveryMutation.isPending ? "Enviando..." : "Enviar enlace"}
            </Button>
          </div>
        </div>
      </Modal>
    </main>
  );
}
