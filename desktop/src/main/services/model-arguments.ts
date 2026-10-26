interface ServiceArgumentConfigurator {
  configureServiceArg(id: string, name: string, value: string): void;
}

export function configureServiceModelArguments(
  manager: ServiceArgumentConfigurator,
  tutorModel: string,
): void {
  const tutor = tutorModel.trim();
  if (!tutor) {
    throw new Error('A tutor model ID is required.');
  }
  manager.configureServiceArg('tutor-server', 'model_name', tutor);
}

export function startModelServices(manager: {
  startService(id: string): void;
}): void {
  manager.startService('tutor-server');
}
