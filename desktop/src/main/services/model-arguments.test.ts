import {
  configureServiceModelArguments,
  startModelServices,
} from './model-arguments';

describe('configureServiceModelArguments', () => {
  it('applies the saved model ID after an early service-config load', () => {
    const manager = { configureServiceArg: jest.fn() };

    configureServiceModelArguments(manager, 'gemini/gemini-tutor');

    expect(manager.configureServiceArg.mock.calls).toEqual([
      ['tutor-server', 'model_name', 'gemini/gemini-tutor'],
    ]);
  });

  it('refuses to configure services with an empty model ID', () => {
    const manager = { configureServiceArg: jest.fn() };

    expect(() => configureServiceModelArguments(manager, '')).toThrow(
      'A tutor model ID is required.',
    );
    expect(manager.configureServiceArg).not.toHaveBeenCalled();
  });
});

it('starts only the tutor service', () => {
  const manager = { startService: jest.fn() };
  startModelServices(manager);
  expect(manager.startService.mock.calls).toEqual([['tutor-server']]);
});
