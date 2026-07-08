type AlertMessagesProps = {
  error?: string;
  successMessage?: string;
};

export default function AlertMessages({ error, successMessage }: AlertMessagesProps) {
  return (
    <>
      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-800 dark:bg-red-900 dark:text-red-200">
          {error}
        </div>
      )}
      {successMessage && (
        <div className="rounded-lg bg-green-50 p-4 text-sm text-green-800 dark:bg-green-900 dark:text-green-200">
          {successMessage}
        </div>
      )}
    </>
  );
}
