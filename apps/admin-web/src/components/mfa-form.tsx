"use client";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  isValidTotpCode,
  normalizeTotpCode,
  totpQrDataUrl
} from "@/lib/mfa";
import {
  ArrowRight,
  Check,
  Copy,
  LoaderCircle,
  LogOut,
  QrCode
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

interface Enrollment {
  readonly factorId: string;
  readonly qrCode: string;
  readonly secret: string;
}

export function MfaForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error: factorsError } =
          await createBrowserSupabaseClient().auth.mfa.listFactors();
        if (!active) {
          return;
        }
        if (factorsError) {
          setError("Не удалось получить способы подтверждения.");
        } else {
          setVerifiedFactorId(data.totp[0]?.id ?? null);
        }
      } catch {
        if (active) {
          setError("Сервис авторизации временно недоступен.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function enroll() {
    if (pending) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: factors, error: factorsError } =
        await supabase.auth.mfa.listFactors();
      if (factorsError) {
        setError("Не удалось проверить существующие способы подтверждения.");
        return;
      }
      for (const factor of factors.all) {
        if (factor.factor_type === "totp" && factor.status === "unverified") {
          const { error: unenrollError } = await supabase.auth.mfa.unenroll({
            factorId: factor.id
          });
          if (unenrollError) {
            setError("Не удалось заменить незавершённую настройку MFA.");
            return;
          }
        }
      }
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Операционная панель",
        issuer: "Ticket Platform"
      });
      if (enrollError) {
        setError("Не удалось создать способ подтверждения.");
        return;
      }
      setEnrollment({
        factorId: data.id,
        qrCode: totpQrDataUrl(data.totp.qr_code),
        secret: data.totp.secret
      });
      setCode("");
    } catch {
      setError("Сервис авторизации временно недоступен.");
    } finally {
      setPending(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const factorId = enrollment?.factorId ?? verifiedFactorId;
    if (!factorId || !isValidTotpCode(code) || pending) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { error: verifyError } =
        await createBrowserSupabaseClient().auth.mfa.challengeAndVerify({
          factorId,
          code
        });
      if (verifyError) {
        setError("Код не принят. Проверьте время на устройстве и повторите.");
        return;
      }
      router.replace("/tasks");
      router.refresh();
    } catch {
      setError("Сервис авторизации временно недоступен.");
    } finally {
      setPending(false);
    }
  }

  async function signOut() {
    setPending(true);
    try {
      await createBrowserSupabaseClient().auth.signOut();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  async function copySecret() {
    if (!enrollment) {
      return;
    }
    try {
      await navigator.clipboard.writeText(enrollment.secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Не удалось скопировать секрет.");
    }
  }

  if (loading) {
    return (
      <div className="mfa-loading" role="status">
        <LoaderCircle className="spin" size={20} />
        Проверяем способы подтверждения
      </div>
    );
  }

  const factorId = enrollment?.factorId ?? verifiedFactorId;

  return (
    <div className="mfa-form">
      {!factorId ? (
        <div className="mfa-enroll-start">
          <QrCode size={22} />
          <p>Подключите TOTP-приложение для защищённого входа.</p>
          <button
            className="primary-button"
            type="button"
            disabled={pending}
            onClick={() => void enroll()}
          >
            {pending ? <LoaderCircle className="spin" size={18} /> : <QrCode size={18} />}
            Подключить MFA
          </button>
        </div>
      ) : null}

      {enrollment ? (
        <div className="mfa-enrollment">
          <Image
            className="mfa-qr"
            src={enrollment.qrCode}
            alt="QR-код для приложения-аутентификатора"
            width={220}
            height={220}
            unoptimized
          />
          <div className="mfa-secret">
            <span>Резервный секрет</span>
            <div>
              <code>{enrollment.secret}</code>
              <button
                className="icon-button"
                type="button"
                title="Скопировать секрет"
                aria-label="Скопировать секрет"
                onClick={() => void copySecret()}
              >
                {copied ? <Check size={17} /> : <Copy size={17} />}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {factorId ? (
        <form className="mfa-code-form" onSubmit={(event) => void verify(event)}>
          <label>
            <span>Код из приложения</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              pattern="[0-9]{6}"
              maxLength={6}
              required
              disabled={pending}
              onChange={(event) => setCode(normalizeTotpCode(event.target.value))}
              autoFocus
            />
          </label>
          <button
            className="primary-button"
            type="submit"
            disabled={pending || !isValidTotpCode(code)}
          >
            {pending ? <LoaderCircle className="spin" size={18} /> : null}
            <span>{pending ? "Проверяем" : "Подтвердить"}</span>
            {!pending ? <ArrowRight size={18} /> : null}
          </button>
        </form>
      ) : null}

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button
        className="mfa-sign-out"
        type="button"
        disabled={pending}
        onClick={() => void signOut()}
      >
        <LogOut size={16} />
        Выйти из учётной записи
      </button>
    </div>
  );
}
