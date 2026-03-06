import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  danger = false,
  loading = false,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-zinc-300">{description}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button type="button" className={danger ? "bg-red-700 hover:bg-red-600" : ""} onClick={onConfirm} disabled={loading}>
            {loading ? "Procesando..." : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
