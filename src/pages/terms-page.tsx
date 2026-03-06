import { Card } from "@/components/ui/card";

export default function TermsPage() {
  return (
    <main className="mx-auto grid min-h-screen w-full max-w-3xl gap-4 p-6">
      <Card className="space-y-4 p-6">
        <h1 className="text-2xl font-black">Terminos y condiciones</h1>
        <p className="text-sm text-zinc-300">
          Al usar Velion aceptas estas reglas basicas de uso, seguridad y moderacion.
        </p>
        <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-200">
          <li>No publiques contenido ilegal, fraudulento o que vulnere derechos de terceros.</li>
          <li>Eres responsable de la seguridad de tu cuenta y de tus credenciales.</li>
          <li>Velion puede moderar, limitar o suspender cuentas por incumplimientos.</li>
          <li>El contenido que compartes puede mostrarse dentro de la plataforma segun tus ajustes de privacidad.</li>
          <li>Las funciones pueden cambiar para mejorar seguridad, estabilidad y cumplimiento.</li>
        </ul>
        <p className="text-xs text-zinc-400">
          Para dudas legales o soporte:{" "}
          <a className="underline" href="mailto:soporte@velion.app">
            soporte@velion.app
          </a>
        </p>
      </Card>
    </main>
  );
}
