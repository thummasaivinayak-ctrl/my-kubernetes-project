import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { postsApi } from '../lib/api';

function CreatePost() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const response = await postsApi.post('/api/posts', { title, content });
      navigate(`/posts/${response.data.id}`);
    } catch {
      setError('Failed to create post');
    }
  };

  return (
    <div className="page">
      <h1>Create New Post</h1>
      {error && <div className="error-message">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="title">Title</label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="content">Content</label>
          <textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
          />
        </div>
        <button className="btn" type="submit">
          Publish Post
        </button>
      </form>
    </div>
  );
}

export default CreatePost;
