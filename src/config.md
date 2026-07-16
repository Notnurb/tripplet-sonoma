# App Config

Customize the app here — no code changes needed. The dev server reads this
file when it starts, so restart it (`./setup.sh` → Run server, or `npm run dev`)
after editing. You can also edit everything below interactively with the
setup TUI: run `./setup.sh` (Git Bash/WSL on Windows) or `npm run setup`.

> Note: saving changes from the setup TUI rewrites this file in this exact
> format, so keep extra notes in your own docs rather than inline here.

## App

- name: Tripplet
- tagline: AI that works the way you think
- description: Chat, Build and Explore new ideas with Tripplet Sonoma
- port: 3000

## Model backends

Each `###` entry defines a model backend. The heading is the model id. Use an
id matching a built-in persona (`astro-5`, `tura-3`, `majuli-3`, `suzhou-3`)
to reroute that persona to your own endpoint, or invent a new id to add a
brand-new model to the app.

Fields per entry:

- `label` — display name shown in the model picker
- `description` — one-liner shown under the name
- `endpoint` — OpenAI-compatible `/chat/completions` URL
- `model` — upstream model name sent to that endpoint
- `api key env` — name of the environment variable holding the API key (put the key itself in `.env`)
- `show in picker` — yes/no, adds new ids to the model dropdown (built-in ids are already there)
- `enabled` — yes/no

### my-local-llama
- label: Local Llama
- description: Llama running on my own machine
- endpoint: http://localhost:11434/v1/chat/completions
- model: llama3.2
- api key env: LOCAL_LLAMA_API_KEY
- show in picker: yes
- enabled: no
