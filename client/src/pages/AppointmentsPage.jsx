import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CalendarDays, CalendarPlus, CheckCircle2, ChevronLeft, ChevronRight, Clock,
  CircleSlash, UserCheck, UserX, Users,
} from 'lucide-react';
import { api } from '../api/client';
import { useDataChanged } from '../hooks/useDataChanged';
import {
  Badge, Button, Card, Empty, ErrorNote, Field, Modal, Money, PageHeader,
  SegmentedControl, Spinner, useToast,
} from '../components/ui';
import { formatDate, formatTime } from '../lib/format';
import { cn } from '../lib/cn';
import { EASE_OUT } from '../lib/motion';

/**
 * The day, and what is in it.
 *
 * Free times are never worked out here. They come from the database function
 * that knows about opening hours, closures, buffers and what is already booked;
 * the browser only draws them. Anything else and two screens would eventually
 * disagree about whether 10:00 is free, and one of them would be taking money.
 *
 * There is no free-text time box for the same reason: a typed time can be one
 * the shop is shut or one already taken, and the only honest response at that
 * point is a refusal. Offering only real slots avoids the question.
 */

const STATUS = {
  requested: { label: 'Not confirmed', tone: 'amber', icon: Clock },
  confirmed: { label: 'Confirmed', tone: 'blue', icon: CheckCircle2 },
  arrived: { label: 'Here', tone: 'green', icon: UserCheck },
  completed: { label: 'Done', tone: 'slate', icon: CheckCircle2 },
  no_show: { label: 'No show', tone: 'red', icon: UserX },
  cancelled: { label: 'Cancelled', tone: 'slate', icon: CircleSlash },
};

const isoDay = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const addDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return isoDay(d);
};

export default function AppointmentsPage() {
  const [date, setDate] = useState(() => isoDay(new Date()));
  const [view, setView] = useState('day');
  const [day, setDay] = useState(null);
  const [week, setWeek] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [moving, setMoving] = useState(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (view === 'day') {
        setDay(await api.appointments.day(date));
        setWeek([]);
      } else {
        const start = addDays(date, -new Date(`${date}T12:00:00`).getDay());
        const result = await api.appointments.list({
          from: new Date(`${start}T00:00:00`).toISOString(),
          to: new Date(`${addDays(start, 7)}T00:00:00`).toISOString(),
          pageSize: 400,
        });
        setWeek(result.items || []);
        setDay(null);
      }
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [date, view]);

  useEffect(() => { load(); }, [load]);

  // A booking made by Receptionist AI shows up here without a reload.
  useDataChanged(load, ['appointments']);

  const setStatus = async (appointment, status) => {
    try {
      await api.appointments.setStatus(appointment.id, status);
      toast.success(`${appointment.reference} — ${STATUS[status].label.toLowerCase()}`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const appointments = view === 'day' ? day?.appointments || [] : week;
  const today = isoDay(new Date());

  return (
    <>
      <PageHeader
        eyebrow="Front desk"
        title="Appointments"
        subtitle="Everything booked, and what is still free."
        icon={CalendarDays}
      >
        <Button icon={CalendarPlus} onClick={() => setBooking(true)}>Book</Button>
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="secondary" size="sm" icon={ChevronLeft} aria-label="Go back"
            onClick={() => setDate(addDays(date, view === 'day' ? -1 : -7))}
          />
          <button
            type="button"
            onClick={() => setDate(today)}
            className="rounded-xl px-3 py-1.5 text-[13.5px] font-semibold hover:bg-[var(--wash)]"
          >
            {date === today ? 'Today' : formatDate(`${date}T12:00:00`, { weekday: 'short', day: 'numeric', month: 'short' })}
          </button>
          <Button
            variant="secondary" size="sm" icon={ChevronRight} aria-label="Go forward"
            onClick={() => setDate(addDays(date, view === 'day' ? 1 : 7))}
          />
        </div>

        <SegmentedControl
          value={view}
          onChange={setView}
          ariaLabel="Day or week"
          options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]}
        />

        <label className="ml-auto flex items-center gap-2 text-[13px] text-ink-2">
          <span className="sr-only">Jump to a date</span>
          <CalendarDays size={15} aria-hidden="true" />
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="input-field w-auto rounded-full"
          />
        </label>
      </div>

      <ErrorNote error={error} onDismiss={() => setError(null)} />

      {loading ? (
        <div className="grid h-52 place-items-center"><Spinner /></div>
      ) : !appointments.length ? (
        <Empty
          icon={CalendarDays}
          title="Nothing booked"
          message={view === 'day' ? 'This day is completely free.' : 'Nothing booked this week.'}
          action={<Button icon={CalendarPlus} onClick={() => setBooking(true)}>Book something</Button>}
        />
      ) : (
        <div className="space-y-2.5">
          <AnimatePresence initial={false}>
            {appointments.map((appointment) => (
              <AppointmentRow
                key={appointment.id}
                appointment={appointment}
                showDay={view === 'week'}
                onStatus={setStatus}
                onMove={() => setMoving(appointment)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {view === 'day' && day?.waiting?.length > 0 && (
        <Card className="mt-6 p-5">
          <p className="mb-3 flex items-center gap-2 text-[14px] font-semibold">
            <Users size={16} aria-hidden="true" /> Waiting for a slot
          </p>
          <ul className="space-y-1.5 text-[13.5px] text-ink-2">
            {day.waiting.map((entry) => (
              <li key={entry.id}>{entry.customer_name || 'Someone'} — {entry.service_name}</li>
            ))}
          </ul>
        </Card>
      )}

      {booking && (
        <BookingModal
          onClose={() => setBooking(false)}
          onBooked={() => { setBooking(false); load(); }}
          defaultDate={date}
        />
      )}
      {moving && (
        <MoveModal
          appointment={moving}
          onClose={() => setMoving(null)}
          onMoved={() => { setMoving(null); load(); }}
        />
      )}
    </>
  );
}

function AppointmentRow({ appointment, showDay, onStatus, onMove }) {
  const status = STATUS[appointment.status] || STATUS.requested;
  const Icon = status.icon;
  const settled = ['completed', 'cancelled', 'no_show'].includes(appointment.status);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25, ease: EASE_OUT }}
      className={cn('card flex flex-wrap items-center gap-4 p-4', settled && 'opacity-60')}
    >
      <div className="min-w-[88px]">
        <p className="text-[17px] font-semibold tabular-nums tracking-[-0.01em]">{formatTime(appointment.starts_at)}</p>
        <p className="text-[12px] text-ink-3">
          {showDay
            ? formatDate(appointment.starts_at, { weekday: 'short', day: 'numeric', month: 'short' })
            : `${appointment.duration_minutes} min`}
        </p>
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[14.5px] font-semibold">{appointment.customer_name || 'No name given'}</p>
        <p className="truncate text-[13px] text-ink-2">
          {appointment.service_name} · {appointment.resource_name}
          {appointment.notes ? ` · ${appointment.notes}` : ''}
        </p>
      </div>

      {Number(appointment.price) > 0 && (
        <Money value={appointment.price} className="hidden text-[14px] font-semibold sm:block" />
      )}

      <Badge tone={status.tone} icon>
        <Icon size={12} aria-hidden="true" /> {status.label}
      </Badge>

      {!settled && (
        <div className="flex flex-wrap items-center gap-1.5">
          {appointment.status === 'requested' && (
            <Button size="sm" variant="secondary" onClick={() => onStatus(appointment, 'confirmed')}>Confirm</Button>
          )}
          {appointment.status !== 'arrived' && (
            <Button size="sm" variant="secondary" onClick={() => onStatus(appointment, 'arrived')}>Arrived</Button>
          )}
          <Button size="sm" variant="secondary" onClick={onMove}>Move</Button>
          <Button size="sm" variant="quiet" onClick={() => onStatus(appointment, 'no_show')}>No show</Button>
          <Button size="sm" variant="danger-quiet" onClick={() => onStatus(appointment, 'cancelled')}>Cancel</Button>
        </div>
      )}
    </motion.div>
  );
}

/** The free times for a service on a day, straight from the database. */
function SlotPicker({ slots, loading, chosen, onChoose, emptyMessage }) {
  if (loading) return <div className="grid h-20 place-items-center"><Spinner /></div>;
  if (!slots.length) return <p className="text-[13.5px] text-ink-3">{emptyMessage}</p>;

  return (
    <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto" data-lenis-prevent>
      {slots.map((slot) => {
        const active = chosen?.starts_at === slot.starts_at && chosen?.resource_id === slot.resource_id;
        return (
          <button
            key={`${slot.resource_id}-${slot.starts_at}`}
            type="button"
            aria-pressed={active}
            onClick={() => onChoose(slot)}
            className={cn(
              'rounded-xl px-3 py-2 text-[13.5px] font-medium transition-colors duration-200',
              active ? 'bg-accent text-white' : 'bg-[var(--wash)] text-ink hover:bg-[var(--wash-strong)]'
            )}
          >
            {formatTime(slot.starts_at)}
            {slot.resource_name && (
              <span className={cn('ml-1.5 text-[11.5px]', active ? 'text-white/75' : 'text-ink-3')}>
                {slot.resource_name}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Loads free slots for a service and day. Shared by booking and moving. */
function useSlots({ serviceId, date, enabled = true }) {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled || !serviceId || !date) { setSlots([]); return undefined; }
    let live = true;
    setLoading(true);
    api.appointments
      .availability({
        service_id: serviceId,
        from: new Date(`${date}T00:00:00`).toISOString(),
        to: new Date(`${addDays(date, 1)}T00:00:00`).toISOString(),
      })
      .then((result) => { if (live) { setSlots(result.items || []); setError(null); } })
      .catch((err) => { if (live) setError(err.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [serviceId, date, enabled]);

  return { slots, loading, error };
}

function BookingModal({ onClose, onBooked, defaultDate }) {
  const [services, setServices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [serviceId, setServiceId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [chosen, setChosen] = useState(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const toast = useToast();

  const { slots, loading, error: slotError } = useSlots({ serviceId, date });

  useEffect(() => {
    Promise.all([api.services.list({ pageSize: 100 }), api.customers.list({ pageSize: 200 })])
      .then(([serviceList, customerList]) => {
        const active = (serviceList.rows || []).filter((row) => row.is_active);
        setServices(active);
        setCustomers(customerList.rows || []);
        if (active.length === 1) setServiceId(String(active[0].id));
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => { setChosen(null); }, [serviceId, date]);

  const book = async (event) => {
    event.preventDefault();
    if (!chosen) return;
    setSaving(true);
    try {
      const created = await api.appointments.create({
        service_id: Number(serviceId),
        resource_id: chosen.resource_id,
        starts_at: chosen.starts_at,
        customer_id: customerId ? Number(customerId) : null,
        status: 'confirmed',
        source: 'operator',
        notes: notes || null,
      });
      toast.success(`Booked ${created.reference}`);
      onBooked();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal title="Book an appointment" subtitle="Only times that are actually free are offered" icon={CalendarPlus} onClose={onClose} size="lg">
      <form onSubmit={book} className="space-y-4">
        <ErrorNote error={error || slotError} onDismiss={() => setError(null)} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="What for">
            <select className="input-field" value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
              <option value="">Choose a service…</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>{service.name} ({service.duration_minutes} min)</option>
              ))}
            </select>
          </Field>
          <Field label="Day">
            <input className="input-field" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>

        <Field label="Free times">
          {!serviceId ? (
            <p className="text-[13.5px] text-ink-3">Choose a service to see what is free.</p>
          ) : (
            <SlotPicker
              slots={slots}
              loading={loading}
              chosen={chosen}
              onChoose={setChosen}
              emptyMessage="Nothing free on this day. Try another, or check your opening hours in Settings."
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Who for" hint="Leave blank if they are not a customer yet">
            <select className="input-field" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Nobody on file</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Note">
            <input className="input-field" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth remembering" />
          </Field>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!chosen}>Book it</Button>
        </div>
      </form>
    </Modal>
  );
}

function MoveModal({ appointment, onClose, onMoved }) {
  const [date, setDate] = useState(() => isoDay(new Date(appointment.starts_at)));
  const [chosen, setChosen] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const toast = useToast();

  const { slots, loading, error: slotError } = useSlots({ serviceId: appointment.service_id, date });

  useEffect(() => { setChosen(null); }, [date]);

  const move = async (event) => {
    event.preventDefault();
    if (!chosen) return;
    setSaving(true);
    try {
      await api.appointments.reschedule(appointment.id, {
        starts_at: chosen.starts_at,
        resource_id: chosen.resource_id,
        reason: 'Moved from the appointments page',
      });
      toast.success(`${appointment.reference} moved`);
      onMoved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Move ${appointment.reference}`}
      subtitle={`${appointment.customer_name || 'No name'} — ${appointment.service_name}`}
      icon={Clock}
      onClose={onClose}
    >
      <form onSubmit={move} className="space-y-4">
        <ErrorNote error={error || slotError} onDismiss={() => setError(null)} />

        <p className="text-[13.5px] text-ink-2">
          Currently {formatDate(appointment.starts_at, { weekday: 'short', day: 'numeric', month: 'short' })} at{' '}
          {formatTime(appointment.starts_at)}.
        </p>

        <Field label="New day">
          <input className="input-field" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>

        <Field label="Free times">
          <SlotPicker
            slots={slots}
            loading={loading}
            chosen={chosen}
            onChoose={setChosen}
            emptyMessage="Nothing free on this day."
          />
        </Field>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Leave it</Button>
          <Button type="submit" loading={saving} disabled={!chosen}>Move it</Button>
        </div>
      </form>
    </Modal>
  );
}
