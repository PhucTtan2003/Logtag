public static class TaskExtensions
{
    public static void Forget(this Task task)
    {
        // Tùy chọn: log exception nếu cần
        task.ContinueWith(t =>
        {
            if (t.Exception != null)
            {
                Console.WriteLine($"[Task.Forget] {t.Exception}");
            }
        }, TaskContinuationOptions.OnlyOnFaulted);
    }
}
