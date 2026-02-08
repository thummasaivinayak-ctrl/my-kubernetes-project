import { useState, useEffect } from 'react';
import { postsApi } from '../lib/api';
import PostCard from '../components/PostCard';

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
    return <div className="page">Loading posts...</div>;
  }

  return (
    <div className="page">
      <h1>Latest Posts</h1>
      {posts.length === 0 ? (
        <p>No posts yet. Be the first to write one!</p>
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
