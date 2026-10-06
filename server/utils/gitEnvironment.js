// git finds the repository from the folder it runs in, never from variables a caller (a git hook) left set
const REPO_VARIABLES =
	/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|PREFIX)$/;

const gitEnvironment = () =>
	Object.fromEntries(Object.entries(process.env).filter(([name]) => !REPO_VARIABLES.test(name)));

export default gitEnvironment;
