# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting (the **Security** tab of this repository, "Report a vulnerability"). You will get an answer as soon as possible.

## How the API key is handled

The Groq API key is stored in clear in the extension's local storage in your browser: an extension cannot encrypt a secret in a useful way. It is never available to web pages (page scripts do not load it), it is only sent to the provider over HTTPS, it is masked in the diagnostic log, and the settings page never writes it back into the page. Use a dedicated key that you can revoke from Groq's console. Details: [docs/design-notes.md](docs/design-notes.md), section "Security of the API key".
