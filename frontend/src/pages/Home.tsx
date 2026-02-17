import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { postsApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import PostCard from '../components/PostCard';
import { getAvatarColor, getInitial } from '../lib/utils';

interface Post {
  id: string;
  title: string;
  content: string;
  authorName: string;
  createdAt: string;
}

function Home() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    async function fetchPosts() {
      try {
        const response = await postsApi.get('/api/posts');
        setPosts(response.data.posts);
      } catch {
        console.error('Failed to fetch posts');
      } finally {
        setLoading(false);
      }
    }

    fetchPosts();
  }, []);

  if (loading) {
    return (
      <div className="page">
        <div className="loading-spinner">
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {isAuthenticated && (
        <div className="create-post-prompt" onClick={() => navigate('/posts/new')}>
          <span
            className="avatar avatar-md"
            style={{ background: getAvatarColor(user?.name || '') }}
          >
            {getInitial(user?.name || '')}
          </span>
          <div className="prompt-input">What's on your mind, {user?.name}?</div>
        </div>
      )}

      {posts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">&#9997;</div>
          <h3>No posts yet</h3>
          <p>Be the first to share something with the community!</p>
        </div>
      ) : (
        posts.map((post) => (
          <PostCard
            key={post.id}
            id={post.id}
            title={post.title}
            content={post.content}
            authorName={post.authorName}
            createdAt={post.createdAt}
          />
        ))
      )}
    </div>
  );
}

export default Home;
