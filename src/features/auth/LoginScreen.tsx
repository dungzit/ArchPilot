import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertCircle, Compass, Info, LogIn } from 'lucide-react'
import { login, type User } from '../../api/auth'
import { isApiError } from '../../api/client'
import { copy, type Copy, type TextFn } from '../../ui/copy'

export type LoginNotice = 'expired' | 'unreachable' | 'signed-out'

/**
 * Local username/password sign-in (task 1.2). Deliberately plain: one form, two
 * fields, one button, one error line. Every string goes through `copy(vi, en)`.
 *
 * Accessibility: real <label>s, a <form> so Enter submits, focus on the first
 * field on arrival and on the field to fix after an error, the error is
 * announced (role="alert") and tied to the inputs with aria-describedby.
 */
export function LoginScreen({
  text,
  language,
  onToggleLanguage,
  onLoggedIn,
  notice,
}: {
  text: TextFn
  language: 'vi' | 'en'
  onToggleLanguage: () => void
  onLoggedIn: (user: User) => void
  notice?: LoginNotice | null
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<Copy | null>(notice === 'unreachable' ? MESSAGES.unreachable : null)
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    usernameRef.current?.focus()
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    if (!username.trim() || !password) {
      setError(MESSAGES.missing)
      ;(username.trim() ? passwordRef : usernameRef).current?.focus()
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const response = await login(username.trim(), password)
      onLoggedIn(response.user)
    } catch (caught) {
      const message = loginErrorMessage(caught)
      setError(message)
      setSubmitting(false)
      if (isApiError(caught) && caught.status === 401) {
        // Keep the username, clear and refocus the password: that is the field to fix.
        setPassword('')
        passwordRef.current?.focus()
      }
    }
  }

  const noticeCopy = notice === 'expired' ? MESSAGES.expired : notice === 'signed-out' ? MESSAGES.signedOut : null
  const errorId = error ? 'login-error' : undefined

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-card-header">
          <div className="auth-brand">
            <div className="brand-mark" aria-hidden="true"><Compass size={20} strokeWidth={2.5} /></div>
            <div className="brand-name">ArchPilot</div>
          </div>
          <button
            type="button"
            className="language-toggle"
            onClick={onToggleLanguage}
            aria-label={text(copy('Chuyển sang tiếng Anh', 'Switch to Vietnamese'))}
          >
            <span className={language === 'vi' ? 'selected' : ''}>VI</span>
            <span className={language === 'en' ? 'selected' : ''}>EN</span>
          </button>
        </div>

        <h1 id="login-title">{text(copy('Đăng nhập', 'Sign in'))}</h1>
        <p className="auth-lead">{text(copy('Dùng tài khoản nội bộ ArchPilot của bạn.', 'Use your internal ArchPilot account.'))}</p>

        {noticeCopy && !error && (
          <p className="auth-notice" role="status"><Info size={15} aria-hidden="true" /> {text(noticeCopy)}</p>
        )}

        <form className="form-column auth-form" onSubmit={submit} noValidate aria-busy={submitting}>
          <label htmlFor="login-username">
            {text(copy('Tên đăng nhập', 'Username'))}
            <input
              ref={usernameRef}
              id="login-username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={64}
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              aria-invalid={error === MESSAGES.missing && !username.trim() ? true : undefined}
              aria-describedby={errorId}
            />
          </label>
          <label htmlFor="login-password">
            {text(copy('Mật khẩu', 'Password'))}
            <input
              ref={passwordRef}
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              maxLength={256}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={error === MESSAGES.wrongPassword || (error === MESSAGES.missing && !password) ? true : undefined}
              aria-describedby={errorId}
            />
          </label>

          {error && (
            <p className="auth-error" id="login-error" role="alert">
              <AlertCircle size={15} aria-hidden="true" /> <span>{text(error)}</span>
            </p>
          )}

          <button type="submit" className="primary-button auth-submit" disabled={submitting}>
            <LogIn size={15} aria-hidden="true" />
            {submitting ? text(copy('Đang đăng nhập…', 'Signing in…')) : text(copy('Đăng nhập', 'Sign in'))}
          </button>
        </form>

        <p className="auth-footnote">
          {text(copy(
            'Chưa có tài khoản? Quản trị viên tạo tài khoản bằng scripts/create_user.py.',
            'No account yet? An administrator creates one with scripts/create_user.py.',
          ))}
        </p>
      </section>
    </main>
  )
}

const MESSAGES = {
  wrongPassword: copy('Sai tên đăng nhập hoặc mật khẩu.', 'Wrong username or password.'),
  throttled: copy(
    'Bạn đã nhập sai quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.',
    'Too many failed attempts. Wait a few minutes, then try again.',
  ),
  unreachable: copy(
    'Không kết nối được máy chủ ArchPilot. Kiểm tra backend đã chạy chưa rồi thử lại.',
    'Cannot reach the ArchPilot server. Check that the backend is running, then try again.',
  ),
  missing: copy('Nhập tên đăng nhập và mật khẩu.', 'Enter your username and password.'),
  expired: copy('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 'Your session has expired. Please sign in again.'),
  signedOut: copy('Bạn đã đăng xuất.', 'You have signed out.'),
} as const

/** Map any failure from `login()` to the one line the user sees. Exported for tests. */
export function loginErrorMessage(error: unknown): Copy {
  if (!isApiError(error)) return MESSAGES.unreachable
  if (error.kind === 'unreachable') return MESSAGES.unreachable
  if (error.status === 401) return MESSAGES.wrongPassword
  if (error.status === 429) return MESSAGES.throttled
  if (error.status === 422) return MESSAGES.missing
  const reference = error.requestId ? ` (ref ${error.requestId})` : ''
  return copy(
    `Đăng nhập thất bại: ${error.detail}${reference}`,
    `Sign-in failed: ${error.detail}${reference}`,
  )
}
