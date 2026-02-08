import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { postsApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import CommentList from '../components/CommentList';

interface Post {
  id: string;
  title: string;
  content: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

function PostDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchPost() {
      try {
        const response = await postsApi.get(`/api/posts/${id}`);
        setPost(response.data);
        setEditTitle(response.data.title);
        setEditContent(response.data.content);
      } catch {
        setError('Post not found');
      } finally {
        setLoading(false);
      }
    }

    fetchPost();
  }, [id]);

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this post?')) return;

    try {
      await postsApi.delete(`/api/posts/${id}`);
      navigate('/');
    } catch {
      setError('Failed to delete post');
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const response = await postsApi.put(`/api/posts/${id}`, {
        title: editTitle,
        content: editContent,
      });
      setPost(response.data);
      setEditing(false);
    } catch {
      setError('Failed to update post');
    }
  };

  if (loading) {
    return <div className="page">Loading...</div>;
  }

  if (!post) {
    return <div className="page">{error || 'Post not found'}</div>;
  }

  const date = new Date(post.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const isAuthor = user && user.id === post.authorId;

  if (editing) {
    return (
      <div className="page">
        <h1>Edit Post</h1>
        {error && <div className="error-message">{error}</div>}
        <form onSubmit={handleUpdate}>
          <div className="form-group">
            <label htmlFor="title">Title</label>
            <input
              id="title"
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="content">Content</label>
            <textarea
              id="content"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              required
            />
          </div>
          <button className="btn" type="submit">
            Save Changes
          </button>{' '}
          <button className="btn btn-secondary" type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="post-detail">
        <h1>{post.title}</h1>
        <div className="meta">
          By {post.authorName} on {date}
        </div>
        <div className="content">{post.content}</div>
        {isAuthor && (
          <div className="actions">
            <button className="btn" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button className="btn btn-danger" onClick={handleDelete}>
              Delete
            </button>
          </div>
        )}
      </div>

      <CommentList postId={post.id} />
    </div>
  );
}

export default PostDetail;
