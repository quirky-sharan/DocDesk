import { useCallback, useEffect, useState } from 'react';
import { Check, LogOut, ShieldCheck, Trash2, UserCheck, UserX } from 'lucide-react';
import { api } from '../api/client';
import { displayNameFor, useAuth } from '../auth/AuthProvider';
import { Avatar, Badge, Button, ConfirmButton, Notice, Select, useToast } from './ui';
import { formatRelative } from '../lib/format';

const ROLES = [
  ['staff', 'Staff', 'The day-to-day: sales, stock, customers, appointments, files and messages.'],
  ['manager', 'Manager', 'Everything staff can, plus settings, opening hours and services, AI settings, and looking inside the database.'],
  ['owner', 'Owner', 'Everything, including changing the database directly, downloading or restoring backups, and this list.'],
];

/**
 * Who may use this DocDesk, and as what. Only the owner sees it.
 *
 * Anybody can create an account, so creating one grants nothing: a new person
 * shows up here as waiting, and stays that way until they are let in. The
 * server enforces every rule on this screen - it is a way to change the list,
 * not the thing that guards it.
 */
export default function TeamGroup({ Group }) {
  const { user: me, can, signInRequired } = useAuth();
  const [members, setMembers] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const toast = useToast();
  const isOwner = can('owner');

  const load = useCallback(() => {
    api.team
      .list()
      .then((data) => {
        setMembers(data.items);
        setError(null);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (isOwner) load();
  }, [isOwner, load]);

  if (!isOwner) return null;

  async function change(member, changes, done) {
    setBusy(member.id);
    try {
      await api.team.update(member.id, changes);
      toast.success(done);
      load();
    } catch (err) {
      toast.error('That did not go through', { description: err.message });
    } finally {
      setBusy(null);
    }
  }

  async function remove(member) {
    try {
      await api.team.remove(member.id);
      toast.success(`${displayNameFor(member)} removed`);
      load();
    } catch (err) {
      toast.error('Could not remove them', { description: err.message });
    }
  }

  async function signOutEverywhere(member) {
    try {
      await api.team.signOut(member.id);
      toast.success(`${displayNameFor(member)} signed out everywhere`);
      load();
    } catch (err) {
      toast.error('Could not sign them out', { description: err.message });
    }
  }

  const waiting = (members || []).filter((m) => m.status === 'pending').length;

  return (
    <Group
      id="team"
      icon={ShieldCheck}
      title="Team"
      subtitle="Who can sign in to this DocDesk, and what each of them may do."
      tint="#ff375f"
      action={waiting > 0 ? <Badge tone="amber" icon>{waiting} waiting</Badge> : null}
    >
      {!signInRequired && (
        <Notice tone="warning" title="Sign-in is switched off on this computer">
          <code>AUTH_REQUIRED=off</code> is set in <code>server/.env</code>, so anyone using this computer is treated as the owner. Remove that line and restart DocDesk to turn sign-in back on.
        </Notice>
      )}
      {error && <Notice tone="danger">{error}</Notice>}

      {!members ? (
        <div className="skeleton h-24 rounded-[16px]" />
      ) : members.length === 0 ? (
        <p className="text-[13.5px] text-ink-2">Nobody has signed in yet. The first person who does becomes the owner.</p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {members.map((member) => {
            const isMe = member.id === me?.id;
            const name = displayNameFor(member);
            return (
              <li key={member.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <Avatar name={name} size={36} />
                <div className="min-w-0 flex-1 basis-48">
                  <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium">
                    <span className="truncate">{name}</span>
                    {isMe && <Badge tone="blue">You</Badge>}
                    {member.status === 'pending' && <Badge tone="amber" icon>Waiting to be let in</Badge>}
                    {member.status === 'disabled' && <Badge tone="red" icon>Switched off</Badge>}
                  </p>
                  <p className="truncate text-[12.5px] text-ink-3">
                    {member.email || 'No email on this account'}
                    {member.lastSeenAt && ` · last here ${formatRelative(member.lastSeenAt)}`}
                  </p>
                </div>

                {member.status === 'pending' ? (
                  <Button size="sm" icon={UserCheck} loading={busy === member.id} onClick={() => change(member, { status: 'active' }, `${name} can now sign in`)}>
                    Let in
                  </Button>
                ) : isMe ? (
                  // Nobody changes their own access: an owner who demoted
                  // themselves by accident would have no way to undo it.
                  <Badge tone="slate">{ROLES.find(([value]) => value === member.role)?.[1] || member.role}</Badge>
                ) : (
                  <Select
                    className="min-w-[120px]"
                    value={member.role}
                    options={ROLES.map(([value, label]) => [value, label])}
                    onChange={(role) => role !== member.role && change(member, { role }, `${name} is now ${role === 'owner' ? 'an owner' : `a ${role}`}`)}
                  />
                )}

                {!isMe && member.status === 'active' && (
                  <>
                    {member.sessions > 0 && (
                      <Button variant="quiet" size="sm" icon={LogOut} title="Sign them out of every browser" aria-label={`Sign ${name} out everywhere`} onClick={() => signOutEverywhere(member)} />
                    )}
                    <ConfirmButton className="btn-edit btn-icon btn-sm" icon={UserX} title="Switch this account off" confirmLabel="Switch off" message={`Switch off ${name}'s account? They are signed out straight away and cannot sign back in until you switch it on again.`} onConfirm={() => change(member, { status: 'disabled' }, `${name} switched off`)} />
                  </>
                )}
                {!isMe && member.status === 'disabled' && (
                  <Button variant="secondary" size="sm" icon={Check} loading={busy === member.id} onClick={() => change(member, { status: 'active' }, `${name} switched back on`)}>
                    Switch on
                  </Button>
                )}
                {!isMe && (
                  <ConfirmButton className="btn-danger btn-icon btn-sm" icon={Trash2} title="Remove from the team" confirmLabel="Remove" message={`Remove ${name}? If they sign in again they will be back to waiting.`} onConfirm={() => remove(member)} />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <dl className="mt-5 grid grid-cols-1 gap-2 md:grid-cols-3">
        {ROLES.map(([value, label, summary]) => (
          <div key={value} className="rounded-[16px] px-4 py-3" style={{ background: 'var(--wash)' }}>
            <dt className="text-[13px] font-semibold">{label}</dt>
            <dd className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{summary}</dd>
          </div>
        ))}
      </dl>
    </Group>
  );
}
