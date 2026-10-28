// Email + password sign-in and password screens for self-hosted installs
// (window.__MANUS_CONFIG__.localLogin). Manus installs never render these.
import { trpc } from "@/lib/trpc";
import { KeyRound, LoaderCircle, LogIn } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Field, Modal } from "./Modal";

const MIN_PASSWORD = 8;

/** Where to go after signing in: only a path on this site, never another site. */
function nextPath() {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function PasswordLogin() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="password-login"
      onSubmit={async event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setBusy(true);
        setError("");
        try {
          const response = await fetch("/api/auth/login", {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              email: String(form.get("email") ?? ""),
              password: String(form.get("password") ?? ""),
            }),
          });
          if (response.ok) {
            window.location.href = nextPath();
            return;
          }
          const body = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          setError(body?.error ?? "Sign-in failed. Try again.");
        } catch {
          setError(
            "Cannot reach the gym server. Check the internet connection."
          );
        }
        setBusy(false);
      }}
    >
      <Field label="Email">
        <input
          type="email"
          name="email"
          autoComplete="username"
          required
          autoFocus
        />
      </Field>
      <Field label="Password">
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
        />
      </Field>
      {error && (
        <p className="error-copy" role="alert">
          {error}
        </p>
      )}
      <button className="button button-primary button-wide" disabled={busy}>
        {busy ? (
          <LoaderCircle className="spin" size={17} />
        ) : (
          <LogIn size={17} />
        )}
        Sign in
      </button>
    </form>
  );
}

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const change = trpc.auth.changePassword.useMutation();
  const [error, setError] = useState("");
  return (
    <Modal
      open
      title="Change your password"
      description="Other devices signed in with this login are signed out."
      onClose={onClose}
    >
      <form
        className="form-grid"
        onSubmit={event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const newPassword = String(form.get("newPassword") ?? "");
          if (newPassword !== String(form.get("confirm") ?? "")) {
            setError("The two new passwords do not match.");
            return;
          }
          setError("");
          change.mutate(
            {
              currentPassword: String(form.get("currentPassword") ?? ""),
              newPassword,
            },
            {
              onSuccess: () => {
                toast.success("Password changed");
                onClose();
              },
              onError: e => setError(e.message),
            }
          );
        }}
      >
        <Field label="Current password" className="form-section-span">
          <input
            type="password"
            name="currentPassword"
            autoComplete="current-password"
            required
          />
        </Field>
        <Field
          label="New password"
          hint={`At least ${MIN_PASSWORD} characters.`}
        >
          <input
            type="password"
            name="newPassword"
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            required
          />
        </Field>
        <Field label="New password again">
          <input
            type="password"
            name="confirm"
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            required
          />
        </Field>
        {error && (
          <p className="error-copy form-section-span" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions form-section-span">
          <button
            className="button button-secondary"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button-primary" disabled={change.isPending}>
            <KeyRound size={15} />
            Change password
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Admin sets or resets the password of a staff or member login. */
export function SetPasswordModal({
  email,
  name,
  onClose,
  onDone,
}: {
  email: string;
  name?: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const setPassword = trpc.auth.setPasswordFor.useMutation();
  const [error, setError] = useState("");
  return (
    <Modal
      open
      title={`Password for ${name || email}`}
      description="Tell them the password in person. They can change it after signing in. Their other devices are signed out."
      onClose={onClose}
    >
      <form
        className="form-grid"
        onSubmit={event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setError("");
          setPassword.mutate(
            { email, password: String(form.get("password") ?? "") },
            {
              onSuccess: () => {
                toast.success(`Password saved. ${email} can sign in now.`);
                onDone();
                onClose();
              },
              onError: e => setError(e.message),
            }
          );
        }}
      >
        <Field label="Sign-in email">
          <input value={email} readOnly />
        </Field>
        <Field
          label="New password"
          hint={`At least ${MIN_PASSWORD} characters.`}
        >
          <input
            type="text"
            name="password"
            autoComplete="off"
            minLength={MIN_PASSWORD}
            required
            autoFocus
          />
        </Field>
        {error && (
          <p className="error-copy form-section-span" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions form-section-span">
          <button
            className="button button-secondary"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button button-primary"
            disabled={setPassword.isPending}
          >
            <KeyRound size={15} />
            Save password
          </button>
        </div>
      </form>
    </Modal>
  );
}
