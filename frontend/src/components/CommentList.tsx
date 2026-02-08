import { useState, useEffect, useCallback } from 'react';
import { commentsApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';

interface Comment {
  id: string;
  content: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

interface CommentListProps {
  postId: string;
}

function CommentList({ postId }: CommentListProps) {
  const { isAuthenticated, user } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [error, setError] = useState('');

  const fetchComments = useCallback(async () => {
    try {
      const response = await commentsApi.get(`/api/comments?postId=${postId}`);
      setComments(response.data);
    } catch {
      console.error('Failed to fetch comments');
    }
  }, [postId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!newComment.trim()) return;

    try {
      await commentsApi.post('/api/comments', { postId, content: newComment });
      setNewComment('');
      fetchComments();
    } catch {
      setError('Failed to add comment');
    }
  };

  const handleDelete = async (commentId: string) => {
    try {
      await commentsApi.delete(`/api/comments/${commentId}`);
      fetchComments();
    } catch {
      setError('Failed to delete comment');
    }
  };

  return (
    <div className="comments-section">
      <h2>Comments ({comments.length})</h2>

      {isAuthenticated && (
        <form className="comment-form" onSubmit={handleSubmit}>
          {error && <div className="error-message">{error}</div>}
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Write a comment..."
          />
          <button className="btn" type="submit">
            Add Comment
          </button>
        </form>
      )}

      {comments.map((comment) => {
        const date = new Date(comment.createdAt).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });

        return (
          <div key={comment.id} className="comment">
            <div className="meta">
              {comment.authorName} on {date}
            </div>
            <div className="content">{comment.content}</div>
            {user && user.id === comment.authorId && (
              <button className="delete-btn" onClick={() => handleDelete(comment.id)}>
                Delete
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default CommentList;
