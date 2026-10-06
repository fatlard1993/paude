import { Button, Elem, Input, View, styled } from '@vanilla-bean/components';

const Card = styled(
	Elem,
	({ colors }) => `
		margin: auto;
		width: min(340px, calc(100% - 32px));
		display: flex;
		flex-direction: column;
		gap: 12px;

		.title {
			font-size: 1.4em;
			font-weight: bold;
		}

		.message {
			min-height: 1.2em;
			color: ${colors.light(colors.red)};
		}

		.hint {
			color: ${colors.light(colors.gray)};
		}

		code {
			white-space: nowrap;
		}
	`,
);

export default class Login extends View {
	build() {
		const card = new Card({ appendTo: this });

		new Elem({ appendTo: card, addClass: 'title', textContent: 'paude' });

		if (this.options.joinFailed) {
			new Elem({
				appendTo: card,
				addClass: 'message',
				textContent: 'That invite link has expired or was revoked. Ask for a new one.',
			});
		}

		if (!this.options.passwordSet) {
			const hint = new Elem({ appendTo: card, addClass: 'hint' });

			hint.elem.innerHTML =
				'No password is set yet. On the server, run <code>bun run set-password</code> in the paude folder.';

			return;
		}

		this.password = new Input({
			appendTo: card,
			type: 'password',
			placeholder: 'Password',
			attributes: { autocomplete: 'current-password', autofocus: true },
			onKeyDown: event => {
				if (event.key === 'Enter') this.login();
			},
		});
		this.button = new Button({ appendTo: card, textContent: 'Log in', onPointerPress: () => this.login() });
		this.message = new Elem({ appendTo: card, addClass: 'message' });
	}

	async login() {
		const password = this.password.elem.value;

		if (!password || this.busy) return;

		this.busy = true;
		this.message.elem.textContent = '';

		const response = await fetch('/api/login', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ password }),
		});

		this.busy = false;

		if (response.ok) return window.location.reload();

		this.password.elem.value = '';
		this.message.elem.textContent =
			response.status === 429
				? `Too many tries. Wait ${response.headers.get('retry-after')}s.`
				: 'That password is not right.';
	}
}
