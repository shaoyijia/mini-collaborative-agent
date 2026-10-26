import { useEffect, useState } from 'react';
import type { ModelDraft, ConnectionTestStatus } from './ModelsStep';

export default function useModelSetup() {
  const [modelError, setModelError] = useState('');
  const [savingModels, setSavingModels] = useState(false);
  const [tutorModels, setTutorModels] = useState<ModelDraft[]>([]);
  const [defaultTutorId, setDefaultTutorId] = useState('');
  const [connectionTests, setConnectionTests] = useState<
    Record<string, ConnectionTestStatus>
  >({});

  const testModelConnection = async (model: ModelDraft) => {
    const key = model.id;
    if (!model.model.trim()) {
      setConnectionTests((current) => ({
        ...current,
        [key]: { state: 'error', message: 'Enter a model ID first.' },
      }));
      return;
    }
    setConnectionTests((current) => ({
      ...current,
      [key]: { state: 'testing', message: '' },
    }));
    const result = await window.electron?.ipcRenderer.invoke(
      'test-model-connection',
      {
        connection: {
          id: model.id,
          label: model.label || 'Chat',
          provider: model.provider,
          model: model.model,
          baseUrl: model.baseUrl,
        },
        apiKey: model.apiKey,
      },
    );
    const response = result as
      | {
          success?: boolean;
          message?: string;
          error?: string;
        }
      | undefined;
    setConnectionTests((current) => ({
      ...current,
      [key]: response?.success
        ? { state: 'success', message: response.message || 'Connected.' }
        : { state: 'error', message: response?.error || 'Connection failed.' },
    }));
  };

  useEffect(() => {
    window.electron?.ipcRenderer
      .invoke('get-model-configuration')
      .then(async (config: any) => {
        if (!config || !Array.isArray(config.tutors)) {
          const status = await window.electron?.ipcRenderer.invoke(
            'pi-provider',
            'status',
          );
          if (status?.connection?.mode === 'native') {
            const { provider, model } = status.connection;
            setTutorModels([
              {
                id: 'legacy-pi-chat',
                label: `Pi · ${model}`,
                provider: 'pi',
                model: `pi/${provider}/${model}`,
                apiKey: '',
                baseUrl: '',
              },
            ]);
            setDefaultTutorId('legacy-pi-chat');
          }
          return undefined;
        }
        setTutorModels(
          config.tutors.map((item: any) => ({
            ...item,
            model: String(item.model).replace(/^(?:hosted_vllm|tinker)\//, ''),
            apiKey: '',
            baseUrl: item.baseUrl ?? '',
          })),
        );
        setDefaultTutorId(config.defaultTutorId);
        return undefined;
      })
      .catch(() => {});
  }, []);

  const saveModels = async () => {
    try {
      if (!tutorModels.length) {
        setModelError(
          'Add a Pi model or an additional model connection for chat.',
        );
        return false;
      }
      if (
        tutorModels.some((item) => !item.label.trim() || !item.model.trim())
      ) {
        setModelError('Give every chat model a name and model ID.');
        return false;
      }
      setSavingModels(true);
      setModelError('');
      const credentials: Record<string, string> = {};
      tutorModels.forEach((item) => {
        if (item.apiKey.trim())
          credentials[`tutor:${item.provider}`] = item.apiKey;
      });
      const result = await window.electron?.ipcRenderer.invoke(
        'save-model-configuration',
        {
          tutors: tutorModels.map((item) => ({
            id: item.id,
            label: item.label,
            provider: item.provider,
            model: item.model,
            baseUrl: item.baseUrl,
          })),
          defaultTutorId,
          credentials,
        },
      );
      setSavingModels(false);
      if (!(result as { success?: boolean })?.success) {
        setModelError(
          (result as { error?: string })?.error ||
            'Could not save model configuration.',
        );
        return false;
      }

      return true;
    } catch {
      setModelError('Could not save model configuration. Please try again.');
      return false;
    } finally {
      setSavingModels(false);
    }
  };
  return {
    savingModels,
    saveModels,
    modelProps: {
      tutors: tutorModels,
      setTutors: setTutorModels,
      defaultTutorId,
      setDefaultTutorId,
      error: modelError,
      testStatuses: connectionTests,
      onTest: testModelConnection,
    },
  };
}
