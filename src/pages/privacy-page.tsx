import { Card } from "@/components/ui/card";

export default function PrivacyPage() {
  return (
    <main className="mx-auto grid min-h-screen w-full max-w-3xl gap-4 p-6">
      <Card className="space-y-4 p-6">
        <h1 className="text-2xl font-black">Politica de privacidad</h1>
        <p className="text-sm text-zinc-300">Resumen de como Velion trata datos personales y de uso.</p>
        <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-200">
          <li>Recopilamos datos de cuenta, contenido publicado y eventos tecnicos para operar la plataforma.</li>
          <li>Aplicamos controles de acceso (RLS) para proteger datos por usuario y rol.</li>
          <li>No compartimos datos personales con terceros fuera de proveedores necesarios para operar el servicio.</li>
          <li>Puedes solicitar cambios o eliminacion de cuenta desde configuracion.</li>
          <li>Los eventos tecnicos y errores pueden almacenarse para observabilidad y seguridad operativa.</li>
        </ul>
        <p className="text-xs text-zinc-400">
          Contacto de soporte:{" "}
          <a className="underline" href="mailto:soporte@velion.app">
            soporte@velion.app
          </a>
        </p>
      </Card>
    </main>
  );
}
