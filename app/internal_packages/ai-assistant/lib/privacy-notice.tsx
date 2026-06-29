const ACCEPTED_KEY = 'ai-assistant.privacyNoticeAccepted';

export async function ensurePrivacyNoticeAccepted(): Promise<boolean> {
  if (AppEnv.config.get(ACCEPTED_KEY) === true) return true;
  const { response } = await require('@electron/remote').dialog.showMessageBox({
    type: 'info',
    title: 'AI Assistant',
    message: 'AI features send email content to your configured AI endpoint.',
    detail:
      'When you use the assistant, the relevant email/thread/draft text is sent to the endpoint set in Preferences › AI Assistant. ' +
      'Choose a local endpoint (e.g. Ollama / LM Studio) to keep everything on your machine. Indexing for the knowledge base is always local.',
    buttons: ['Enable AI features', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  });
  const accepted = response === 0;
  if (accepted) AppEnv.config.set(ACCEPTED_KEY, true);
  return accepted;
}
