import { CheckCircle2, CloudOff, MessageCircle, Printer } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useDeviceStore } from '@/stores/deviceStore';
import { formatMoney } from '@/lib/utils';
import type { TicketData } from '@/lib/hardware/escpos';
import { printTicket, ticketToWhatsApp, whatsappLink } from './checkout';

export function ReceiptDialog({
  ticket,
  offline,
  customerPhone,
  symbol,
  onClose,
}: {
  ticket: TicketData | null;
  offline: boolean;
  customerPhone: string | null;
  symbol: string;
  onClose: () => void;
}) {
  const printer = useDeviceStore((s) => s.printer);
  if (!ticket) return null;

  const print = async () => {
    try {
      await printTicket(ticket, printer);
      toast.success('Ticket enviado a la impresora');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Dialog
      open={!!ticket}
      onOpenChange={(v) => !v && onClose()}
      title="Venta registrada"
      size="sm"
      footer={
        <Button variant="meat" size="lg" className="w-full" onClick={onClose} autoFocus>
          Nueva venta
        </Button>
      }
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <motion.div initial={{ scale: 0.4, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }}>
          <CheckCircle2 className="size-16 text-emerald-500" />
        </motion.div>
        <p className="text-sm text-muted-foreground">Ticket N° {ticket.saleNumber}</p>
        <p className="scale-digits text-4xl">{formatMoney(ticket.total, symbol)}</p>
        {ticket.change > 0 && (
          <p className="rounded-lg bg-emerald-500/15 px-4 py-2 text-xl font-bold text-emerald-600 dark:text-emerald-400">
            Vuelto: {formatMoney(ticket.change, symbol)}
          </p>
        )}
        {offline && (
          <p className="flex items-center gap-2 rounded-md bg-bone/15 px-3 py-2 text-sm font-semibold text-bone-dark dark:text-bone">
            <CloudOff className="size-4" /> Guardada sin conexión; se sincronizará automáticamente
          </p>
        )}
        <div className="grid w-full grid-cols-2 gap-2 pt-2">
          <Button variant="outline" onClick={() => void print()}>
            <Printer /> Imprimir
          </Button>
          <Button variant="outline" onClick={() => window.open(whatsappLink(customerPhone, ticketToWhatsApp(ticket, symbol)), '_blank', 'noopener')}>
            <MessageCircle /> WhatsApp
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
