// Infrastructure/SingleFlight.cs
using System.Collections.Concurrent;

namespace temperature_humi.Infrastructure
{
    /// <summary>
    /// Hợp nhất các lời gọi trùng key trong cùng thời điểm để chỉ gọi upstream 1 lần.
    /// - Caller đầu tiên ("leader") chạy factory và hoàn tất Task.
    /// - Các caller sau ("follower") đợi kết quả chung. Follower có thể tự huỷ (CancellationToken)
    ///   mà không ảnh hưởng đến leader.
    /// </summary>
    public class SingleFlight
    {
        private sealed class InFlight
        {
            public TaskCompletionSource<object?> Tcs { get; } =
                new(TaskCreationOptions.RunContinuationsAsynchronously);
        }

        private readonly ConcurrentDictionary<string, InFlight> _map = new();

        /// <summary>
        /// API tương thích ngược. Không truyền CancellationToken.
        /// </summary>
        public Task<T> DoAsync<T>(string key, Func<Task<T>> factory)
            => DoAsync(key, _ => factory(), CancellationToken.None);

        /// <summary>
        /// API đầy đủ: cho phép follower huỷ chờ đợi qua CancellationToken.
        /// Lưu ý: Token chỉ áp dụng cho người đợi. Factory của leader vẫn chạy đến cùng.
        /// </summary>
        public async Task<T> DoAsync<T>(string key, Func<CancellationToken, Task<T>> factory, CancellationToken ct)
        {
            var holder = new InFlight();
            var existing = _map.GetOrAdd(key, holder);

            // Leader: chạy factory, set kết quả cho tất cả, rồi cleanup key
            if (ReferenceEquals(existing, holder))
            {
                try
                {
                    var result = await factory(ct).ConfigureAwait(false);
                    holder.Tcs.TrySetResult(result!);
                    return result;
                }
                catch (OperationCanceledException oce)
                {
                    // Nếu leader bị huỷ, propagate huỷ cho tất cả follower
                    holder.Tcs.TrySetCanceled(oce.CancellationToken);
                    throw;
                }
                catch (Exception ex)
                {
                    holder.Tcs.TrySetException(ex);
                    throw;
                }
                finally
                {
                    _map.TryRemove(key, out _);
                }
            }

            // Follower: đợi kết quả của leader; có thể tự huỷ việc đợi
            if (!ct.CanBeCanceled)
            {
                var obj = await existing.Tcs.Task.ConfigureAwait(false); // propagate lỗi/huỷ tự nhiên
                return (T)obj!;
            }

            // Đợi với huỷ: follower có thể cancel mà không ảnh hưởng leader
            var awaited = await WaitWithCancellation(existing.Tcs.Task, ct).ConfigureAwait(false);
            return (T)awaited!;
        }

        /// <summary>
        /// Đợi task với khả năng huỷ cục bộ dành cho follower (không huỷ task gốc).
        /// </summary>
        private static async Task<object?> WaitWithCancellation(Task<object?> task, CancellationToken ct)
        {
            if (!ct.CanBeCanceled) return await task.ConfigureAwait(false);

            // Nếu framework hỗ trợ .NET 6/7/8 có Task.WaitAsync(CancellationToken) thì có thể dùng:
            // return await task.WaitAsync(ct).ConfigureAwait(false);

            // Cách thủ công tương thích rộng:
            var tcs = new TaskCompletionSource<object?>(TaskCreationOptions.RunContinuationsAsynchronously);
            using var reg = ct.Register(static s => ((TaskCompletionSource<object?>)s!).TrySetCanceled(), tcs);

            var completed = await Task.WhenAny(task, tcs.Task).ConfigureAwait(false);
            if (completed == tcs.Task)
            {
                // follower tự huỷ
                ct.ThrowIfCancellationRequested();
            }

            // task gốc đã hoàn tất (OK/fault/canceled) → await để propagate trạng thái chính xác
            return await task.ConfigureAwait(false);
        }
    }
}