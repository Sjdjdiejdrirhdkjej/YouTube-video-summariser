import {
  InstantSearch,
  SearchBox,
  Hits,
  RefinementList,
} from "react-instantsearch";
import { algoliasearch } from "algoliasearch";

const appId = import.meta.env.VITE_ALGOLIA_APP_ID;
const apiKey = import.meta.env.VITE_ALGOLIA_SEARCH_API_KEY;

if (!appId || !apiKey) {
  throw new Error('VITE_ALGOLIA_APP_ID and VITE_ALGOLIA_SEARCH_API_KEY must be set');
}

const searchClient = algoliasearch(appId, apiKey);

interface Hit {
  name: string;
  description: string;
}

const Search = () => {
  return (
    <InstantSearch searchClient={searchClient} indexName="your_index_name">
      <div className="search-container">
        <SearchBox placeholder="Search..." />
        <div className="search-results">
          <Hits hitComponent={HitComponent} />
        </div>
        <div className="filters">
          <RefinementList attribute="category" />
        </div>
      </div>
    </InstantSearch>
  );
};

const HitComponent = ({ hit }: { hit: Hit }) => (
  <div className="hit">
    <h3>{hit.name}</h3>
    <p>{hit.description}</p>
  </div>
);

export default Search;
